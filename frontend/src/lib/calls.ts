import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiRequest } from "./api";
import type { QueueEntry } from "./queue";

export type CallStatus = "CREATED" | "CONNECTING" | "LIVE" | "ENDED" | "FAILED";

export type BlingCall = {
  id: string;
  showId: string;
  queueEntryId: string;
  status: CallStatus;
  selectionMode: "MANUAL" | "RANDOM";
  callDurationSeconds: number;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
  caller: Pick<
    QueueEntry,
    | "id"
    | "displayName"
    | "topic"
    | "tierName"
    | "priorityRank"
    | "callDurationSeconds"
  >;
};

type CallResponse = { data: BlingCall | null };
const activeCallKey = (showID: string) =>
  ["shows", showID, "calls", "active"] as const;
const viewerCallKey = (showID: string) =>
  ["shows", showID, "calls", "me"] as const;

export function useActiveCall(showID: string) {
  return useQuery({
    queryKey: activeCallKey(showID),
    queryFn: () => getCall(`/api/v1/shows/${showID}/calls/active`),
    enabled: showID.length > 0,
    refetchInterval: 15_000,
  });
}

export function useViewerCall(showID: string) {
  return useQuery({
    queryKey: viewerCallKey(showID),
    queryFn: () => getCall(`/api/v1/shows/${showID}/calls/me`),
    enabled: showID.length > 0,
    refetchInterval: 5_000,
  });
}

async function getCall(path: string) {
  try {
    return (await apiRequest<CallResponse>(path)).data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

function useSelection(showID: string, random: boolean) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (queueEntryId?: string) =>
      (
        await apiRequest<{ data: BlingCall }>(
          `/api/v1/shows/${showID}/calls/${random ? "select-random" : "select"}`,
          {
            method: "POST",
            body: random ? undefined : JSON.stringify({ queueEntryId }),
          },
        )
      ).data,
    onSuccess: (call) => {
      queryClient.setQueryData(activeCallKey(showID), call);
      void queryClient.invalidateQueries({
        queryKey: ["shows", showID, "queue"],
      });
    },
  });
}

export function useSelectCaller(showID: string) {
  return useSelection(showID, false);
}

export function useSelectRandomCaller(showID: string) {
  return useSelection(showID, true);
}

export function useTransitionCall(showID: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      callID,
      status,
    }: {
      callID: string;
      status: CallStatus;
    }) =>
      (
        await apiRequest<{ data: BlingCall }>(
          `/api/v1/shows/${showID}/calls/${callID}/transition`,
          { method: "POST", body: JSON.stringify({ status }) },
        )
      ).data,
    onSuccess: (call) => {
      queryClient.setQueryData(
        activeCallKey(showID),
        call.status === "ENDED" || call.status === "FAILED" ? null : call,
      );
      void queryClient.invalidateQueries({
        queryKey: ["shows", showID, "queue"],
      });
    },
  });
}
