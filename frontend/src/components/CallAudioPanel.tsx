import { useEffect, useRef, useState } from "react";
import { BlingCall } from "../lib/calls";
import { useWebRTCCall } from "../lib/useWebRTCCall";
import { CallRole } from "../lib/webrtc";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

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
  const hasMicrophone = [
    "waiting",
    "connecting",
    "reconnecting",
    "live",
  ].includes(rtc.phase);
  const connectLabel =
    role === "creator"
      ? rtc.phase === "microphone-denied"
        ? "Retry microphone"
        : "Connect to caller"
      : rtc.phase === "microphone-denied"
        ? "Retry microphone"
        : "Allow microphone & connect";

  return (
    <div className="bg-muted mt-4 flex w-full flex-col items-center gap-3 rounded-xl p-5">
      <audio ref={audio} autoPlay playsInline />
      <div
        className="font-mono text-3xl font-semibold tabular-nums"
        aria-label="Call time remaining"
      >
        {formatDuration(rtc.remainingSeconds)}
      </div>
      <p className="text-muted-foreground max-w-prose text-center text-sm">
        {phaseLabel(rtc.phase, role)}
      </p>
      {canConnect && (
        <Button type="button" onClick={() => void rtc.connect()}>
          {connectLabel}
        </Button>
      )}
      {rtc.phase === "requesting-microphone" && (
        <div className="text-muted-foreground text-sm">
          Waiting for microphone permission…
        </div>
      )}
      {rtc.phase === "microphone-denied" && (
        <Alert variant="destructive">
          <AlertDescription>
            Microphone access was denied. Allow it in your browser settings,
            then retry or end this call.
          </AlertDescription>
        </Alert>
      )}
      {rtc.error && (
        <Alert variant="destructive">
          <AlertDescription>{rtc.error}</AlertDescription>
        </Alert>
      )}
      {playRequired && (
        <Button
          variant="secondary"
          type="button"
          onClick={() => void audio.current?.play()}
        >
          Play incoming audio
        </Button>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        {hasMicrophone && (
          <Button variant="secondary" type="button" onClick={rtc.toggleMuted}>
            {rtc.muted ? "Unmute microphone" : "Mute microphone"}
          </Button>
        )}
        <Button
          variant="destructive"
          type="button"
          onClick={() => void rtc.end()}
        >
          End call
        </Button>
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
