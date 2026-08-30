import { waitFor } from "@testing-library/react";
import { WebRTCCallManager, WebRTCCallPhase } from "./webrtc";

class FakeTrack {
  enabled = true;
  stop = vi.fn();
}

class FakeStream {
  readonly track = new FakeTrack();
  getTracks() {
    return [this.track];
  }
  getAudioTracks() {
    return [this.track];
  }
}

class FakePeer {
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  signalingState: RTCSignalingState = "stable";
  connectionState: RTCPeerConnectionState = "new";
  onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null;
  ontrack: ((event: RTCTrackEvent) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  addTrack = vi.fn();
  addIceCandidate = vi.fn().mockResolvedValue(undefined);
  restartIce = vi.fn();
  close = vi.fn(() => {
    this.connectionState = "closed";
  });
  createOffer = vi.fn().mockResolvedValue({ type: "offer", sdp: "offer-sdp" });
  createAnswer = vi
    .fn()
    .mockResolvedValue({ type: "answer", sdp: "answer-sdp" });
  setLocalDescription = vi.fn(
    async (description: RTCSessionDescriptionInit) => {
      this.localDescription = description;
      this.signalingState =
        description.type === "offer" ? "have-local-offer" : "stable";
    },
  );
  setRemoteDescription = vi.fn(
    async (description: RTCSessionDescriptionInit) => {
      this.remoteDescription = description;
      this.signalingState =
        description.type === "offer" ? "have-remote-offer" : "stable";
    },
  );
}

class FakeSocket {
  readyState: number = WebSocket.OPEN;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  send(payload: string) {
    this.sent.push(payload);
  }
  close = vi.fn(() => {
    this.readyState = WebSocket.CLOSED;
  });
  open() {
    this.onopen?.();
  }
  receive(type: string, payload: unknown) {
    this.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({ type, payload }),
      }),
    );
  }
  disconnect() {
    this.readyState = WebSocket.CLOSED;
    this.onclose?.();
  }
}

function setup(role: "creator" | "viewer", getUserMedia = vi.fn()) {
  const phases: WebRTCCallPhase[] = [];
  const peers: FakePeer[] = [];
  const sockets: FakeSocket[] = [];
  const onConnected = vi.fn();
  const onFailure = vi.fn();
  const onLocalReady = vi.fn();
  const manager = new WebRTCCallManager(
    {
      role,
      signalURL: "ws://bling.test/signals",
      iceServers: [{ urls: "stun:relay.test" }],
      onPhase: (phase) => phases.push(phase),
      onRemoteStream: vi.fn(),
      onConnected,
      onFailure,
      onLocalReady,
    },
    {
      getUserMedia,
      createPeer: () => {
        const peer = new FakePeer();
        peers.push(peer);
        return peer as unknown as RTCPeerConnection;
      },
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
      random: () => 0,
    },
  );
  return {
    manager,
    phases,
    peers,
    sockets,
    onConnected,
    onFailure,
    onLocalReady,
  };
}

describe("WebRTCCallManager", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not request media until start and allows retry after denial", async () => {
    const stream = new FakeStream();
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"))
      .mockResolvedValueOnce(stream as unknown as MediaStream);
    const call = setup("viewer", getUserMedia);

    expect(getUserMedia).not.toHaveBeenCalled();
    await call.manager.start();
    expect(call.manager.currentPhase).toBe("microphone-denied");
    expect(call.onFailure).not.toHaveBeenCalled();

    await call.manager.start();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(call.manager.currentPhase).toBe("waiting");
    expect(call.peers[0].addTrack).toHaveBeenCalled();
    await call.manager.end();
    expect(stream.track.stop).toHaveBeenCalledOnce();
  });

  it("waits for caller readiness before offering and exchanges trickle ICE", async () => {
    const stream = new FakeStream();
    const call = setup(
      "creator",
      vi.fn().mockResolvedValue(stream as unknown as MediaStream),
    );
    await call.manager.start();
    call.sockets[0].open();
    expect(call.peers[0].createOffer).not.toHaveBeenCalled();

    call.sockets[0].receive("signal.ready", {});
    await waitFor(() =>
      expect(call.peers[0].createOffer).toHaveBeenCalledOnce(),
    );
    expect(JSON.parse(call.sockets[0].sent[0]).type).toBe("signal.offer");

    call.sockets[0].receive("signal.ice", {
      candidate: { candidate: "remote-candidate" },
    });
    expect(call.peers[0].addIceCandidate).not.toHaveBeenCalled();
    call.sockets[0].receive("signal.answer", {
      sdp: { type: "answer", sdp: "answer-sdp" },
    });
    await waitFor(() =>
      expect(call.peers[0].addIceCandidate).toHaveBeenCalled(),
    );

    call.peers[0].onicecandidate?.({
      candidate: { toJSON: () => ({ candidate: "local-candidate" }) },
    } as RTCPeerConnectionIceEvent);
    expect(
      call.sockets[0].sent.some(
        (message) => JSON.parse(message).type === "signal.ice",
      ),
    ).toBe(true);
  });

  it("answers an offer and reports a connected call once", async () => {
    const call = setup(
      "viewer",
      vi.fn().mockResolvedValue(new FakeStream() as unknown as MediaStream),
    );
    await call.manager.start();
    call.sockets[0].open();
    expect(JSON.parse(call.sockets[0].sent[0]).type).toBe("signal.ready");

    call.sockets[0].receive("signal.offer", {
      sdp: { type: "offer", sdp: "offer-sdp" },
    });
    await waitFor(() =>
      expect(call.peers[0].createAnswer).toHaveBeenCalledOnce(),
    );
    expect(
      call.sockets[0].sent.some(
        (message) => JSON.parse(message).type === "signal.answer",
      ),
    ).toBe(true);

    call.peers[0].connectionState = "connected";
    call.peers[0].onconnectionstatechange?.();
    call.peers[0].onconnectionstatechange?.();
    expect(call.onConnected).toHaveBeenCalledOnce();
    expect(call.manager.currentPhase).toBe("live");
  });

  it("reconnects signaling with backoff and tears down every resource", async () => {
    vi.useFakeTimers();
    const stream = new FakeStream();
    const call = setup(
      "creator",
      vi.fn().mockResolvedValue(stream as unknown as MediaStream),
    );
    await call.manager.start();
    call.sockets[0].open();
    call.sockets[0].disconnect();
    expect(call.sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(250);
    expect(call.sockets).toHaveLength(2);

    await call.manager.end();
    expect(stream.track.stop).toHaveBeenCalledOnce();
    expect(call.peers[0].close).toHaveBeenCalledOnce();
    expect(call.sockets[1].close).toHaveBeenCalledOnce();
  });

	it("allows a failed peer connection to recover during the grace window", async () => {
	  vi.useFakeTimers();
    const stream = new FakeStream();
    const call = setup(
      "creator",
      vi.fn().mockResolvedValue(stream as unknown as MediaStream),
    );
    await call.manager.start();
    call.peers[0].connectionState = "failed";
    call.peers[0].onconnectionstatechange?.();
	expect(call.manager.currentPhase).toBe("reconnecting");
	expect(call.peers[0].restartIce).toHaveBeenCalledOnce();
	call.peers[0].connectionState = "connected";
	call.peers[0].onconnectionstatechange?.();
	expect(call.manager.currentPhase).toBe("live");
	await vi.advanceTimersByTimeAsync(20_000);
	expect(call.onFailure).not.toHaveBeenCalled();
	expect(stream.track.stop).not.toHaveBeenCalled();
  });
});
