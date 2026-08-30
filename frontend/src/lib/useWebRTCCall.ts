import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  BlingCall,
  CallStatus,
  endParticipantCall,
  getRTCConfig,
  participantEndURL,
  transitionParticipantCall,
} from "./calls";
import {
  CallRole,
  WebRTCCallManager,
  WebRTCCallPhase,
  webSocketURL,
} from "./webrtc";

export function useWebRTCCall(call: BlingCall, role: CallRole) {
  const queryClient = useQueryClient();
  const manager = useRef<WebRTCCallManager | null>(null);
  const [phase, setPhase] = useState<WebRTCCallPhase>("idle");
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0);

  const storeCall = useCallback(
    (updated: BlingCall) => {
      if (role === "creator") {
        queryClient.setQueryData(
          ["shows", call.showId, "calls", "active"],
          updated.status === "ENDED" || updated.status === "FAILED"
            ? null
            : updated,
        );
      } else {
        queryClient.setQueryData(
          ["shows", call.showId, "calls", "me"],
          updated,
        );
      }
      void queryClient.invalidateQueries({
        queryKey: ["shows", call.showId, "queue"],
      });
    },
    [call.showId, queryClient, role],
  );

  const updateState = useCallback(
    async (status: CallStatus) => {
      const updated = await transitionParticipantCall(
        call.showId,
        call.id,
        role,
        status,
      );
      storeCall(updated);
    },
    [call.id, call.showId, role, storeCall],
  );

  const connect = useCallback(async () => {
    setError(null);
    if (!manager.current) {
      try {
        const rtcConfig = await getRTCConfig(call.showId, call.id, role);
        manager.current = new WebRTCCallManager({
          role,
          signalURL: webSocketURL(
            `/api/v1/shows/${call.showId}/calls/${call.id}/${role === "creator" ? "creator-signals" : "signals"}`,
          ),
          iceServers: rtcConfig.iceServers,
          onPhase: setPhase,
          onRemoteStream: setRemoteStream,
          onLocalReady:
            role === "creator" ? () => updateState("CONNECTING") : undefined,
          onConnected: () => updateState("LIVE"),
          onFailure: async (failure) => {
            setError(failure.message);
            try {
              await updateState("FAILED");
            } catch {
              // Another participant or the server timer may already have ended it.
            }
          },
        });
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Unable to load call configuration.",
        );
        setPhase("failed");
        return;
      }
    }
    await manager.current.start();
  }, [call.id, call.showId, role, updateState]);

  const toggleMuted = useCallback(() => {
    setMuted((current) => {
      manager.current?.setMuted(!current);
      return !current;
    });
  }, []);

  const end = useCallback(async () => {
    setError(null);
    await manager.current?.end();
    try {
      const updated = await endParticipantCall(call.showId, call.id, role);
      storeCall(updated);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to end this call.",
      );
    }
  }, [call.id, call.showId, role, storeCall]);

  useEffect(() => {
    if (call.status === "ENDED" || call.status === "FAILED") {
      void manager.current?.end();
    }
  }, [call.status]);

  useEffect(() => {
    if (!call.startedAt || call.status !== "LIVE") return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [call.startedAt, call.status]);

  useEffect(() => {
    const pageHidden = () => {
      if (call.status !== "ENDED" && call.status !== "FAILED") {
        void manager.current?.end();
        const endpoint = participantEndURL(call.showId, call.id, role);
        if (!navigator.sendBeacon(endpoint)) {
          void fetch(endpoint, {
            method: "POST",
            credentials: "include",
            keepalive: true,
          });
        }
      }
    };
    window.addEventListener("pagehide", pageHidden);
    return () => window.removeEventListener("pagehide", pageHidden);
  }, [call.id, call.showId, call.status, role]);

  useEffect(
    () => () => {
      void manager.current?.end();
      manager.current = null;
    },
    [call.id],
  );

  const remainingSeconds =
    call.startedAt && now > 0
      ? Math.max(
          0,
          Math.ceil(
            ((call.expiresAt
              ? new Date(call.expiresAt).getTime()
              : new Date(call.startedAt).getTime() +
                call.callDurationSeconds * 1_000) -
              now) /
              1_000,
          ),
        )
      : call.callDurationSeconds;

  return {
    phase,
    remoteStream,
    muted,
    error,
    remainingSeconds,
    connect,
    toggleMuted,
    end,
  };
}
