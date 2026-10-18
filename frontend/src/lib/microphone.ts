import { useCallback, useEffect, useRef, useState } from "react";

// The creator's microphone: which one calls use, and the optional pre-show
// check that tests it. The choice is a per-browser convenience, so it lives in
// localStorage and calls fall back to the default microphone without it.

const STORAGE_KEY = "bling:microphone";
const SAMPLE_MS = 5_000;

export function preferredMicrophone(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function rememberMicrophone(deviceId: string) {
  try {
    localStorage.setItem(STORAGE_KEY, deviceId);
  } catch {
    // Private windows may refuse storage; calls then use the default mic.
  }
}

/** Audio constraints for calls and the check, with the chosen microphone. */
export function microphoneConstraints(
  deviceId = preferredMicrophone(),
): MediaTrackConstraints {
  return {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    // ideal, not exact: an unplugged mic falls back instead of failing a call.
    ...(deviceId ? { deviceId: { ideal: deviceId } } : {}),
  };
}

export type MicrophoneStatus =
  | "idle"
  | "requesting"
  | "ready"
  | "denied"
  | "unavailable";

export type SampleStatus = "idle" | "recording" | "playing";

export const canRecordSample = typeof MediaRecorder !== "undefined";

export function useMicrophoneCheck() {
  const [status, setStatus] = useState<MicrophoneStatus>("idle");
  const [level, setLevel] = useState(0);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [sample, setSample] = useState<SampleStatus>("idle");
  const stream = useRef<MediaStream | null>(null);
  const context = useRef<AudioContext | null>(null);
  const frame = useRef<number | null>(null);
  const playback = useRef<HTMLAudioElement | null>(null);

  const release = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    for (const track of stream.current?.getTracks() ?? []) track.stop();
    stream.current = null;
    void context.current?.close();
    context.current = null;
    playback.current?.pause();
    playback.current = null;
    setLevel(0);
    setSample("idle");
  }, []);

  useEffect(() => release, [release]);

  const open = useCallback(
    async (requested: string | null) => {
      release();
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("unavailable");
        return;
      }
      setStatus("requesting");
      let media: MediaStream;
      try {
        media = await navigator.mediaDevices.getUserMedia({
          audio: microphoneConstraints(requested),
          video: false,
        });
      } catch (cause) {
        const name = cause instanceof Error ? cause.name : "";
        setStatus(
          name === "NotAllowedError" || name === "SecurityError"
            ? "denied"
            : "unavailable",
        );
        return;
      }
      stream.current = media;
      const active = media.getAudioTracks()[0]?.getSettings().deviceId ?? null;
      setDeviceId(active);
      if (active) rememberMicrophone(active);
      // Labels are only filled in once the page has microphone permission.
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(
        all.filter((device) => device.kind === "audioinput" && device.deviceId),
      );

      const audio = new AudioContext();
      context.current = audio;
      // A permission prompt can outlast the click's autoplay allowance, which
      // would leave the context suspended and the meter flat.
      void audio.resume();
      const analyser = audio.createAnalyser();
      analyser.fftSize = 1024;
      audio.createMediaStreamSource(media).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      let last = 0;
      const tick = (time: number) => {
        frame.current = requestAnimationFrame(tick);
        if (time - last < 66) return;
        last = time;
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const value of samples) sum += value * value;
        // Speech sits around 0.05–0.2 RMS; scale so normal talking fills
        // most of the meter.
        setLevel(Math.min(1, Math.sqrt(sum / samples.length) * 5));
      };
      frame.current = requestAnimationFrame(tick);
      setStatus("ready");
    },
    [release],
  );

  const start = useCallback(() => open(preferredMicrophone()), [open]);
  const chooseDevice = useCallback((id: string) => open(id), [open]);
  const stop = useCallback(() => {
    release();
    setStatus("idle");
  }, [release]);

  /** Records a few seconds and plays them back, so the creator hears themself. */
  const recordSample = useCallback(() => {
    const media = stream.current;
    if (!media || !canRecordSample) return;
    const recorder = new MediaRecorder(media);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    recorder.onstop = () => {
      if (stream.current !== media) return;
      const url = URL.createObjectURL(
        new Blob(chunks, { type: recorder.mimeType }),
      );
      const player = new Audio(url);
      playback.current = player;
      const finish = () => {
        URL.revokeObjectURL(url);
        setSample("idle");
      };
      player.onended = finish;
      setSample("playing");
      void player.play().catch(finish);
    };
    setSample("recording");
    recorder.start();
    setTimeout(() => {
      if (recorder.state === "recording") recorder.stop();
    }, SAMPLE_MS);
  }, []);

  return {
    status,
    level,
    devices,
    deviceId,
    sample,
    start,
    stop,
    chooseDevice,
    recordSample,
  };
}
