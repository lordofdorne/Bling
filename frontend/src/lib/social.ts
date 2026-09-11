import { useEffect } from "react";
import {
  useInfiniteQuery,
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { apiRequest } from "./api";
import { useMe } from "./auth";

export const categories = [
  "Just chatting",
  "Music",
  "Gaming",
  "Creative",
  "Tech",
] as const;
export type CreatorProfile = {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  avatarUrl: string;
  coverUrl: string;
  category: string;
  published: boolean;
  followerCount: number;
  isLive: boolean;
  liveShowId: string | null;
  liveStartedAt: string | null;
  isFollowing: boolean;
  channelVisitors: number | null;
};
export type ProfileInput = Pick<
  CreatorProfile,
  "displayName" | "bio" | "avatarUrl" | "coverUrl" | "category" | "published"
>;
export type CreatorPage = { items: CreatorProfile[]; nextCursor?: string };
export type LiveNotification = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  showId: string;
  createdAt: string;
  isLive: boolean;
  read: boolean;
};
export type NotificationPage = {
  items: LiveNotification[];
  nextCursor?: string;
  unreadCount: number;
  unreadCapped: boolean;
};
export type DiscoveryFilters = {
  q?: string;
  category?: string;
  live?: boolean;
  following?: boolean;
};
function queryString(filters: DiscoveryFilters, cursor: string) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.category && filters.category !== "All")
    params.set("category", filters.category);
  if (filters.live) params.set("live", "true");
  if (cursor) params.set("cursor", cursor);
  return params.toString();
}
export function useCreators(filters: DiscoveryFilters = {}) {
  const me = useMe();
  return useInfiniteQuery({
    queryKey: [
      "social",
      filters.following ? "following" : "directory",
      {
        q: filters.q?.trim() || "",
        category: filters.category === "All" ? "" : filters.category || "",
        live: Boolean(filters.live),
      },
      me.data?.id ?? "guest",
    ],
    queryFn: async ({ pageParam, signal }) =>
      (
        await apiRequest<{ data: CreatorPage }>(
          `/api/v1/${filters.following ? "following" : "creators"}?${queryString(filters, pageParam)}`,
          { signal },
        )
      ).data,
    initialPageParam: "",
    getNextPageParam: (page) => page.nextCursor || undefined,
    enabled: !me.isPending && (!filters.following || Boolean(me.data)),
    staleTime: 15_000,
    refetchInterval: 30_000,
    maxPages: 10,
  });
}
export function useCreatorProfile(username: string) {
  const me = useMe();
  return useQuery({
    queryKey: ["social", "profile", username, me.data?.id ?? "guest"],
    queryFn: async ({ signal }) =>
      (
        await apiRequest<{ data: CreatorProfile }>(
          `/api/v1/creators/${encodeURIComponent(username)}`,
          { signal },
        )
      ).data,
    enabled: Boolean(username) && !me.isPending,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}
export function useOwnProfile() {
  const me = useMe();
  return useQuery({
    queryKey: ["social", "own-profile", me.data?.id],
    queryFn: async ({ signal }) =>
      (
        await apiRequest<{ data: CreatorProfile }>("/api/v1/profile", {
          signal,
        })
      ).data,
    enabled: Boolean(me.data),
    staleTime: 30_000,
  });
}
export function useSaveProfile() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: ProfileInput) =>
      (
        await apiRequest<{ data: CreatorProfile }>("/api/v1/profile", {
          method: "POST",
          body: JSON.stringify(input),
        })
      ).data,
    onSuccess: () => client.invalidateQueries({ queryKey: ["social"] }),
  });
}
export function useFollowingCount() {
  const me = useMe();
  return useQuery({
    queryKey: ["social", "following-count", me.data?.id],
    queryFn: async ({ signal }) =>
      (
        await apiRequest<{ data: { count: number } }>(
          "/api/v1/following/count",
          { signal },
        )
      ).data.count,
    enabled: Boolean(me.data),
    staleTime: 30_000,
  });
}
function updateProfile(
  p: CreatorProfile,
  id: string,
  following: boolean,
): CreatorProfile {
  return p.id === id
    ? {
        ...p,
        isFollowing: following,
        followerCount: Math.max(
          0,
          p.followerCount +
            (following === p.isFollowing ? 0 : following ? 1 : -1),
        ),
      }
    : p;
}
export function useFollowCreator() {
  const client = useQueryClient();
  return useMutation({
    mutationKey: ["social", "follow"],
    mutationFn: async ({
      profile,
      following,
    }: {
      profile: CreatorProfile;
      following: boolean;
    }) =>
      (
        await apiRequest<{ data: { isFollowing: boolean } }>(
          `/api/v1/creators/${encodeURIComponent(profile.username)}/follow`,
          {
            method: following ? "POST" : "DELETE",
            ...(following ? { body: "{}" } : {}),
          },
        )
      ).data,
    onMutate: async ({ profile, following }) => {
      await client.cancelQueries({ queryKey: ["social"] });
      const snapshots = client.getQueriesData({ queryKey: ["social"] });
      for (const [key, data] of snapshots) {
        if (!data) continue;
        if (key[1] === "directory" || key[1] === "following")
          client.setQueryData(
            key,
            (old: InfiniteData<CreatorPage> | undefined) =>
              old
                ? {
                    ...old,
                    pages: old.pages.map((page) => ({
                      ...page,
                      items: page.items
                        .filter(
                          (p) =>
                            !(
                              key[1] === "following" &&
                              !following &&
                              p.id === profile.id
                            ),
                        )
                        .map((p) => updateProfile(p, profile.id, following)),
                    })),
                  }
                : old,
          );
        if (key[1] === "profile")
          client.setQueryData(key, (old: CreatorProfile | undefined) =>
            old ? updateProfile(old, profile.id, following) : old,
          );
        if (key[1] === "following-count" && typeof data === "number")
          client.setQueryData(key, Math.max(0, data + (following ? 1 : -1)));
      }
      return snapshots;
    },
    onError: (_error, _input, snapshots) => {
      for (const [key, data] of snapshots ?? []) client.setQueryData(key, data);
    },
    onSettled: () => client.invalidateQueries({ queryKey: ["social"] }),
  });
}
export function useFollowBusy() {
  return useIsMutating({ mutationKey: ["social", "follow"] }) > 0;
}
export function useNotifications() {
  const me = useMe();
  return useInfiniteQuery({
    queryKey: ["social", "notifications", me.data?.id],
    queryFn: async ({ pageParam, signal }) =>
      (
        await apiRequest<{ data: NotificationPage }>(
          `/api/v1/notifications${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ""}`,
          { signal },
        )
      ).data,
    initialPageParam: "",
    getNextPageParam: (page) => page.nextCursor || undefined,
    enabled: Boolean(me.data),
    staleTime: 20_000,
    refetchInterval: 30_000,
    maxPages: 10,
  });
}
export function useMarkNotificationsRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) =>
      apiRequest<void>("/api/v1/notifications/read", {
        method: "POST",
        body: JSON.stringify({ ids }),
      }),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["social", "notifications"] }),
  });
}
export function useChannelPresence(username: string, live: boolean) {
  const client = useQueryClient();
  const me = useMe();
  useEffect(() => {
    if (!live || !username || me.isPending) return;
    let controller: AbortController | undefined;
    let busy = false;
    const beat = async () => {
      if (document.visibilityState !== "visible" || busy) return;
      busy = true;
      controller = new AbortController();
      try {
        const result = await apiRequest<{ data: { channelVisitors: number } }>(
          `/api/v1/creators/${encodeURIComponent(username)}/presence`,
          { method: "POST", body: "{}", signal: controller.signal },
        );
        client.setQueriesData<CreatorProfile>(
          { queryKey: ["social", "profile", username] },
          (old) =>
            old
              ? { ...old, channelVisitors: result.data.channelVisitors }
              : old,
        );
      } catch {
        /* Presence is best effort; it must never interrupt calls. */
      } finally {
        busy = false;
      }
    };
    void beat();
    const timer = window.setInterval(() => void beat(), 30_000);
    const visible = () => void beat();
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
      controller?.abort();
    };
  }, [username, live, me.data?.id, me.isPending, client]);
}
export function creatorItems(pages: CreatorPage[] | undefined) {
  return [
    ...new Map(
      (pages ?? []).flatMap((page) => page.items).map((p) => [p.id, p]),
    ).values(),
  ];
}
export const formatCount = (value: number) =>
  new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
