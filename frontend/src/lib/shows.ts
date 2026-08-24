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

const liveShowKey = (username: string) =>
  ["creators", username, "live-show"] as const;

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

export function useStartShow(username: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const created = await apiRequest<ShowResponse>("/api/v1/shows", {
        method: "POST",
      });
      return (
        await apiRequest<ShowResponse>(
          `/api/v1/shows/${created.data.show.id}/start`,
          { method: "POST" },
        )
      ).data.show;
    },
    onSuccess: (show) => queryClient.setQueryData(liveShowKey(username), show),
  });
}

export function useEndShow(username: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (showID: string) =>
      apiRequest<ShowResponse>(`/api/v1/shows/${showID}/end`, {
        method: "POST",
      }),
    onSuccess: () => queryClient.setQueryData(liveShowKey(username), null),
  });
}
