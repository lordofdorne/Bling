import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiRequest } from "./api";

export type ShowStatus = "CREATED" | "LIVE" | "ENDED";

export type HotlineShow = {
  id: string;
  creatorId: string;
  status: ShowStatus;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type ShowResponse = { data: { show: HotlineShow } };

export type HotlineTier = {
  id: string;
  name: string;
  priorityRank: number;
  callDurationSeconds: number;
  priceCents: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type HotlineTierInput = Pick<
  HotlineTier,
  "name" | "callDurationSeconds" | "priceCents" | "enabled"
>;

type TiersResponse = { data: { tiers: HotlineTier[] } };

const liveShowKey = (username: string) =>
  ["creators", username, "live-show"] as const;
const currentShowKey = ["shows", "current"] as const;
const tierConfigKey = (showID: string) =>
  ["shows", showID, "tier-config"] as const;

async function getLiveShow(username: string): Promise<HotlineShow | null> {
  try {
    return (
      await apiRequest<ShowResponse>(
        `/api/v1/creators/${encodeURIComponent(username)}/live-show`,
      )
    ).data.show;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export function useLiveShow(username: string) {
  return useQuery({
    queryKey: liveShowKey(username),
    queryFn: () => getLiveShow(username),
    enabled: username.length > 0,
    staleTime: 10_000,
  });
}

export function useCurrentShow() {
  return useQuery({
    queryKey: currentShowKey,
    queryFn: async (): Promise<HotlineShow | null> => {
      try {
        return (await apiRequest<ShowResponse>("/api/v1/shows/current")).data
          .show;
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
  });
}

export function useCreateShow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      (await apiRequest<ShowResponse>("/api/v1/shows", { method: "POST" })).data
        .show,
    onSuccess: (show) => queryClient.setQueryData(currentShowKey, show),
  });
}

export function useStartShow(username: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (showID: string) =>
      (
        await apiRequest<ShowResponse>(`/api/v1/shows/${showID}/start`, {
          method: "POST",
        })
      ).data.show,
    onSuccess: (show) => {
      queryClient.setQueryData(currentShowKey, show);
      queryClient.setQueryData(liveShowKey(username), show);
    },
  });
}

export function useEndShow(username: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (showID: string) =>
      apiRequest<ShowResponse>(`/api/v1/shows/${showID}/end`, {
        method: "POST",
      }),
    onSuccess: () => {
      queryClient.setQueryData(currentShowKey, null);
      queryClient.setQueryData(liveShowKey(username), null);
    },
  });
}

export function useTierConfiguration(showID: string) {
  return useQuery({
    queryKey: tierConfigKey(showID),
    queryFn: async () =>
      (await apiRequest<TiersResponse>(`/api/v1/shows/${showID}/tier-config`))
        .data.tiers,
    enabled: showID.length > 0,
  });
}

export function useSaveTierConfiguration(showID: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (tiers: HotlineTierInput[]) =>
      (
        await apiRequest<TiersResponse>(`/api/v1/shows/${showID}/tier-config`, {
          method: "PUT",
          body: JSON.stringify({ tiers }),
        })
      ).data.tiers,
    onSuccess: (tiers) =>
      queryClient.setQueryData(tierConfigKey(showID), tiers),
  });
}
