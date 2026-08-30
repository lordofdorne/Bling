import { useEffect, useRef, useState } from "react";
import { BlingCall } from "../lib/calls";
import { useWebRTCCall } from "../lib/useWebRTCCall";
import { CallRole } from "../lib/webrtc";

export function CallAudioPanel({
  call,
  role,
}: {
  call: BlingCall;
  role: CallRole;
}) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playRequired, setPlayRequired] = useState(false);
  const rtc = useWebRTCCall(call, role);

  useEffect(() => {
    if (!audio.current || !rtc.remoteStream) return;
    audio.current.srcObject = rtc.remoteStream;
    void audio.current
      .play()
      .then(() => setPlayRequired(false))
      .catch(() => setPlayRequired(true));
  }, [rtc.remoteStream]);

  const canConnect = rtc.phase === "idle" || rtc.phase === "microphone-denied";
  const hasMicrophone = ["waiting", "connecting", "reconnecting", "live"].includes(rtc.phase);
  const connectLabel =
    role === "creator"
      ? rtc.phase === "microphone-denied"
        ? "Retry microphone"
        : "Connect to caller"
      : rtc.phase === "microphone-denied"
        ? "Retry microphone"
        : "Allow microphone & connect";

  return (
    <div className="audio-call-panel">
      <audio ref={audio} autoPlay playsInline />
      <div className="call-timer" aria-label="Call time remaining">
        {formatDuration(rtc.remainingSeconds)}
      </div>
      <p className="connection-label">{phaseLabel(rtc.phase, role)}</p>
      {canConnect && (
        <button
          className="primary-button"
          type="button"
          onClick={() => void rtc.connect()}
        >
          {connectLabel}
        </button>
      )}
      {rtc.phase === "requesting-microphone" && (
        <div className="status">Waiting for microphone permission…</div>
      )}
      {rtc.phase === "microphone-denied" && (
        <div className="form-error" role="alert">
          Microphone access was denied. Allow it in your browser settings, then
          retry or end this call.
        </div>
      )}
      {rtc.error && (
        <div className="form-error" role="alert">
          {rtc.error}
        </div>
      )}
      {playRequired && (
        <button
          className="button secondary"
          type="button"
          onClick={() => void audio.current?.play()}
        >
          Play incoming audio
        </button>
      )}
      <div className="call-actions">
        {hasMicrophone && (
          <button
            className="button secondary"
            type="button"
            onClick={rtc.toggleMuted}
          >
            {rtc.muted ? "Unmute microphone" : "Mute microphone"}
          </button>
        )}
        <button
          className="danger-button"
          type="button"
          onClick={() => void rtc.end()}
        >
          End call
        </button>
      </div>
    </div>
  );
}

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function phaseLabel(
  phase: ReturnType<typeof useWebRTCCall>["phase"],
  role: CallRole,
) {
  switch (phase) {
    case "idle":
      return role === "creator"
        ? "Ready when you are. The caller’s microphone starts only after they allow it."
        : "The host selected you. Your microphone is still off.";
    case "requesting-microphone":
      return "Your browser is requesting microphone access.";
    case "waiting":
      return role === "creator"
        ? "Waiting for the caller to allow their microphone…"
        : "Microphone ready. Waiting for the host…";
    case "connecting":
      return "Establishing direct peer-to-peer audio…";
    case "reconnecting":
      return "Connection interrupted. Reconnecting for up to 20 seconds…";
    case "live":
      return "Direct audio connected.";
    case "microphone-denied":
      return "Microphone permission is required for this call.";
    case "failed":
      return "The audio connection failed.";
    case "ended":
      return "Call ended.";
  }
}
