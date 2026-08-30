import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { ApiError, apiRequest } from "./api";

export type QueueTier = {
  id: string;
  name: string;
  priorityRank: number;
  callDurationSeconds: number;
};

export type QueueEntry = {
  id: string;
  showId: string;
  displayName: string;
  topic: string;
  status: "WAITING" | "LEFT" | "SELECTED" | "CONNECTING" | "LIVE" | "ENDED";
  tierId: string;
  tierName: string;
  priorityRank: number;
  callDurationSeconds: number;
  joinedAt: string;
};

export type ViewerQueueState = {
  entry: QueueEntry;
  position: number;
};

type TiersResponse = { data: { tiers: QueueTier[] } };
type ViewerResponse = { data: ViewerQueueState };
type QueueResponse = { data: { entries: QueueEntry[] } };

const viewerKey = (showID: string) => ["shows", showID, "queue", "me"] as const;
const creatorQueueKey = (showID: string) => ["shows", showID, "queue"] as const;

async function getViewerState(
  showID: string,
): Promise<ViewerQueueState | null> {
  try {
    return (
      await apiRequest<ViewerResponse>(`/api/v1/shows/${showID}/queue/me`)
    ).data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

function idempotencyKey(showID: string) {
  const storageKey = `bling:queue:${showID}:join-key`;
  const existing = sessionStorage.getItem(storageKey);
  if (existing) return { storageKey, value: existing };
  const value = crypto.randomUUID();
  sessionStorage.setItem(storageKey, value);
  return { storageKey, value };
}

export function useQueueTiers(showID: string) {
  return useQuery({
    queryKey: ["shows", showID, "tiers"],
    queryFn: async () =>
      (await apiRequest<TiersResponse>(`/api/v1/shows/${showID}/tiers`)).data
        .tiers,
    enabled: showID.length > 0,
    staleTime: 30_000,
  });
}

export function useViewerQueue(showID: string) {
  return useQuery({
    queryKey: viewerKey(showID),
    queryFn: () => getViewerState(showID),
    enabled: showID.length > 0,
    refetchInterval: 30_000,
  });
}

export function useJoinQueue(showID: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      displayName: string;
      topic: string;
      tierId: string;
    }) => {
      const key = idempotencyKey(showID);
      const response = await apiRequest<ViewerResponse>(
        `/api/v1/shows/${showID}/queue`,
        {
          method: "POST",
          headers: { "Idempotency-Key": key.value },
          body: JSON.stringify(input),
        },
      );
      sessionStorage.removeItem(key.storageKey);
      return response.data;
    },
    onSuccess: (state) => queryClient.setQueryData(viewerKey(showID), state),
  });
}

export function useLeaveQueue(showID: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiRequest(`/api/v1/shows/${showID}/queue/me`, { method: "DELETE" }),
    onSuccess: () => queryClient.setQueryData(viewerKey(showID), null),
  });
}

export function useCreatorQueue(showID: string) {
  return useQuery({
    queryKey: creatorQueueKey(showID),
    queryFn: async () =>
      (
        await apiRequest<QueueResponse>(
          `/api/v1/shows/${showID}/queue?limit=100`,
        )
      ).data.entries,
    enabled: showID.length > 0,
    refetchInterval: 30_000,
  });
}

export function useQueueEvents(
  showID: string,
  audience: "viewer" | "creator",
  enabled: boolean,
) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!enabled || !showID || typeof WebSocket === "undefined") return;

    let socket: WebSocket | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let stopped = false;

    const synchronize = () => {
      void queryClient.invalidateQueries({ queryKey: viewerKey(showID) });
      void queryClient.invalidateQueries({ queryKey: creatorQueueKey(showID) });
      void queryClient.invalidateQueries({
        queryKey: ["shows", showID, "calls"],
      });
      void queryClient.invalidateQueries({ queryKey: ["creators"] });
    };

    const connect = () => {
      if (stopped) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const endpoint = audience === "creator" ? "creator-events" : "events";
      socket = new WebSocket(
        `${protocol}//${window.location.host}/api/v1/shows/${showID}/queue/${endpoint}`,
      );
      socket.onopen = () => {
        attempts = 0;
        synchronize();
      };
      socket.onmessage = (message) => {
        try {
          const event = JSON.parse(String(message.data)) as { showId?: string };
          if (event.showId === showID) synchronize();
        } catch {
          // Ignore malformed transport data; REST remains authoritative.
        }
      };
      socket.onclose = () => {
        if (stopped) return;
        const ceiling = Math.min(30_000, 500 * 2 ** attempts++);
        const delay = ceiling * (0.5 + Math.random());
        reconnectTimer = setTimeout(connect, delay);
      };
      socket.onerror = () => socket?.close();
    };

    connect();
    return () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close(1000, "page changed");
    };
  }, [audience, enabled, queryClient, showID]);
}
