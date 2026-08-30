export type CallRole = "creator" | "viewer";

export type WebRTCCallPhase =
  | "idle"
  | "requesting-microphone"
  | "waiting"
  | "connecting"
  | "live"
  | "microphone-denied"
  | "failed"
  | "ended";

type SignalType =
  "signal.ready" | "signal.offer" | "signal.answer" | "signal.ice";

type SignalEnvelope = {
  type: SignalType;
  payload: unknown;
};

type WebRTCCallOptions = {
  role: CallRole;
  signalURL: string;
  iceServers: RTCIceServer[];
  onPhase: (phase: WebRTCCallPhase) => void;
  onRemoteStream: (stream: MediaStream | null) => void;
  onLocalReady?: () => Promise<void> | void;
  onConnected?: () => Promise<void> | void;
  onFailure?: (error: Error) => Promise<void> | void;
};

type WebRTCDependencies = {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createPeer: (configuration: RTCConfiguration) => RTCPeerConnection;
  createSocket: (url: string) => WebSocket;
  setTimer: typeof window.setTimeout;
  clearTimer: typeof window.clearTimeout;
  random: () => number;
};

const defaultDependencies: WebRTCDependencies = {
  getUserMedia: (constraints) =>
    navigator.mediaDevices.getUserMedia(constraints),
  createPeer: (configuration) => new RTCPeerConnection(configuration),
  createSocket: (url) => new WebSocket(url),
  setTimer: (handler, timeout) => window.setTimeout(handler, timeout),
  clearTimer: (timer) => window.clearTimeout(timer),
  random: Math.random,
};

export class WebRTCCallManager {
  private readonly options: WebRTCCallOptions;
  private readonly dependencies: WebRTCDependencies;
  private phase: WebRTCCallPhase = "idle";
  private localStream: MediaStream | null = null;
  private peer: RTCPeerConnection | null = null;
  private socket: WebSocket | null = null;
  private remoteCandidates: RTCIceCandidateInit[] = [];
  private signalChain: Promise<void> = Promise.resolve();
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  private disconnectTimer: number | null = null;
  private readyTimer: number | null = null;
  private closing = false;
  private connectedNotified = false;

  constructor(
    options: WebRTCCallOptions,
    dependencies: Partial<WebRTCDependencies> = {},
  ) {
    this.options = options;
    this.dependencies = { ...defaultDependencies, ...dependencies };
  }

  get currentPhase() {
    return this.phase;
  }

  async start() {
    if (
      this.phase === "requesting-microphone" ||
      this.phase === "waiting" ||
      this.phase === "connecting" ||
      this.phase === "live"
    )
      return;

    this.closing = false;
    this.setPhase("requesting-microphone");
    try {
      this.localStream = await this.dependencies.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
    } catch (cause) {
      const error = asError(cause);
      if (error.name === "NotAllowedError" || error.name === "SecurityError") {
        this.setPhase("microphone-denied");
        return;
      }
      await this.fail(error);
      return;
    }

    try {
      this.createPeer();
      await this.options.onLocalReady?.();
      this.setPhase("waiting");
      this.openSocket();
    } catch (cause) {
      await this.fail(asError(cause));
    }
  }

  setMuted(muted: boolean) {
    for (const track of this.localStream?.getAudioTracks() ?? []) {
      track.enabled = !muted;
    }
  }

  async end() {
    this.setPhase("ended");
    this.cleanup();
  }

  private createPeer() {
    const peer = this.dependencies.createPeer({
      iceServers: this.options.iceServers,
      bundlePolicy: "max-bundle",
    });
    this.peer = peer;
    for (const track of this.localStream?.getTracks() ?? []) {
      peer.addTrack(track, this.localStream!);
    }
    peer.onicecandidate = (event) => {
      if (event.candidate) {
        this.send("signal.ice", { candidate: event.candidate.toJSON() });
      }
    };
    peer.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      this.options.onRemoteStream(stream);
    };
    peer.onconnectionstatechange = () => this.connectionChanged();
  }

  private openSocket() {
    if (this.closing) return;
    const socket = this.dependencies.createSocket(this.options.signalURL);
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.reconnectAttempts = 0;
      if (this.options.role === "viewer") {
        this.startReadyPulse();
      } else if (
        this.peer?.signalingState === "have-local-offer" &&
        this.peer.localDescription
      ) {
        this.send("signal.offer", { sdp: this.peer.localDescription });
      }
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      this.signalChain = this.signalChain
        .then(() => this.handleSignal(String(event.data)))
        .catch((cause) => this.fail(asError(cause)));
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (!this.closing) this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer !== null) return;
    const ceiling = Math.min(10_000, 500 * 2 ** this.reconnectAttempts++);
    const delay = ceiling * (0.5 + this.dependencies.random());
    this.reconnectTimer = this.dependencies.setTimer(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private startReadyPulse() {
    this.stopReadyPulse();
    const announce = () => {
      if (this.closing || this.peer?.remoteDescription) return;
      this.send("signal.ready", {});
      this.readyTimer = this.dependencies.setTimer(announce, 2_000);
    };
    announce();
  }

  private stopReadyPulse() {
    if (this.readyTimer !== null) {
      this.dependencies.clearTimer(this.readyTimer);
      this.readyTimer = null;
    }
  }

  private async handleSignal(raw: string) {
    const signal = JSON.parse(raw) as SignalEnvelope;
    if (!signal || typeof signal.type !== "string") return;
    if (signal.type === "signal.ready" && this.options.role === "creator") {
      await this.offer();
      return;
    }
    if (signal.type === "signal.offer" && this.options.role === "viewer") {
      const sdp = payloadRecord(signal.payload)
        .sdp as RTCSessionDescriptionInit;
      this.stopReadyPulse();
      await this.peer?.setRemoteDescription(sdp);
      await this.flushRemoteCandidates();
      const answer = await this.peer?.createAnswer();
      if (!answer || !this.peer) return;
      await this.peer.setLocalDescription(answer);
      this.send("signal.answer", { sdp: this.peer.localDescription });
      this.setPhase("connecting");
      return;
    }
    if (signal.type === "signal.answer" && this.options.role === "creator") {
      const sdp = payloadRecord(signal.payload)
        .sdp as RTCSessionDescriptionInit;
      await this.peer?.setRemoteDescription(sdp);
      await this.flushRemoteCandidates();
      this.setPhase("connecting");
      return;
    }
    if (signal.type === "signal.ice") {
      const candidate = payloadRecord(signal.payload)
        .candidate as RTCIceCandidateInit;
      if (this.peer?.remoteDescription) {
        await this.peer.addIceCandidate(candidate);
      } else {
        this.remoteCandidates.push(candidate);
      }
    }
  }

  private async offer() {
    if (!this.peer) return;
    if (
      this.peer.signalingState === "have-local-offer" &&
      this.peer.localDescription
    ) {
      this.send("signal.offer", { sdp: this.peer.localDescription });
      return;
    }
    if (this.peer.signalingState !== "stable") return;
    const offer = await this.peer.createOffer();
    await this.peer.setLocalDescription(offer);
    this.send("signal.offer", { sdp: this.peer.localDescription });
    this.setPhase("connecting");
  }

  private async flushRemoteCandidates() {
    const candidates = this.remoteCandidates.splice(0);
    for (const candidate of candidates) {
      await this.peer?.addIceCandidate(candidate);
    }
  }

  private connectionChanged() {
    const state = this.peer?.connectionState;
    if (state === "connected") {
      if (this.disconnectTimer !== null) {
        this.dependencies.clearTimer(this.disconnectTimer);
        this.disconnectTimer = null;
      }
      this.setPhase("live");
      if (!this.connectedNotified) {
        this.connectedNotified = true;
        void Promise.resolve(this.options.onConnected?.()).catch((cause) =>
          this.fail(asError(cause)),
        );
      }
      return;
    }
    if (state === "failed") {
      void this.fail(new Error("The peer-to-peer audio connection failed."));
      return;
    }
    if (state === "disconnected" && this.disconnectTimer === null) {
      this.disconnectTimer = this.dependencies.setTimer(() => {
        this.disconnectTimer = null;
        if (this.peer?.connectionState === "disconnected") {
          void this.fail(new Error("The audio connection was lost."));
        }
      }, 10_000);
    }
  }

  private send(type: SignalType, payload: unknown) {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type, payload }));
  }

  private async fail(error: Error) {
    if (this.phase === "failed" || this.phase === "ended") return;
    this.setPhase("failed");
    this.cleanup();
    await this.options.onFailure?.(error);
  }

  private cleanup() {
    this.closing = true;
    if (this.reconnectTimer !== null)
      this.dependencies.clearTimer(this.reconnectTimer);
    if (this.disconnectTimer !== null)
      this.dependencies.clearTimer(this.disconnectTimer);
    this.stopReadyPulse();
    this.reconnectTimer = null;
    this.disconnectTimer = null;
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000, "call ended");
    this.peer?.close();
    this.peer = null;
    for (const track of this.localStream?.getTracks() ?? []) track.stop();
    this.localStream = null;
    this.remoteCandidates = [];
    this.options.onRemoteStream(null);
  }

  private setPhase(phase: WebRTCCallPhase) {
    this.phase = phase;
    this.options.onPhase(phase);
  }
}

export function webSocketURL(path: string) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${path}`;
}

function payloadRecord(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid signaling payload.");
  }
  return payload as Record<string, unknown>;
}

function asError(cause: unknown) {
  if (cause instanceof Error) return cause;
  if (cause && typeof cause === "object") {
    const value = cause as { name?: unknown; message?: unknown };
    const error = new Error(
      typeof value.message === "string"
        ? value.message
        : "WebRTC operation failed.",
    );
    if (typeof value.name === "string") error.name = value.name;
    return error;
  }
  return new Error("WebRTC operation failed.");
}
