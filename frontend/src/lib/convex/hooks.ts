import { useAuthActions } from "@convex-dev/auth/react";
import { convexQuery } from "@convex-dev/react-query";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useConvexAuth } from "convex/react";
import { ConvexError } from "convex/values";
import { useEffect } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { ApiError } from "../api";
import type {
  Creator,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
} from "../auth";
import {
  convexClient,
  iso,
  runAction,
  runMutation,
  runQuery,
  toApiError,
} from "../backend";
import type { CallStatus } from "../calls";
import type { PaymentActivity, PayoutFailure } from "../finance";
import type { PayoutStatus } from "../payouts";
import type { HotlineTierInput } from "../shows";
import type {
  CreatorPage,
  DiscoveryFilters,
  NotificationPage,
  ProfileInput,
} from "../social";
import {
  toCall,
  toEntry,
  toProfile,
  toQueueTier,
  toShow,
  toTier,
} from "./mappers";
import { useEnsureSession } from "./session";

// Convex implementations of the hooks in src/lib. Each keeps its Go
// counterpart's name, arguments and result shape, so components do not know
// which backend they use. Reads are live Convex subscriptions fed into
// TanStack Query (see backend.ts); the list views that page keep the Go
// hooks' polling, because their optimistic follow updates rely on it.

const showId = (id: string) => id as Id<"shows">;
const meQuery = convexQuery(api.users.me, {});

// ------------------------------------------------------------ auth

export function useMe() {
  const { isLoading } = useConvexAuth();
  return useQuery({
    ...meQuery,
    enabled: !isLoading,
    select: (user): Creator | null =>
      user && { ...user, createdAt: iso(user.createdAt)! },
  });
}

/** Waits for the new session to reach the server, then primes useMe. */
async function settleSignIn(client: ReturnType<typeof useQueryClient>) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const user = await convexClient().query(api.users.me, {});
    if (user) {
      client.setQueryData(meQuery.queryKey, user);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function authError(cause: unknown, fallback: string) {
  if (cause instanceof ConvexError) return toApiError(cause);
  const text = cause instanceof Error ? cause.message : "";
  if (/already exists/i.test(text)) {
    return new ApiError(
      409,
      "EMAIL_TAKEN",
      "An account already uses that email.",
    );
  }
  return new ApiError(
    401,
    fallback,
    toApiError(new ConvexError({ code: fallback })).message,
  );
}

export function useLogin() {
  const { signIn } = useAuthActions();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ email, password }: LoginInput) => {
      try {
        await signIn("password", { flow: "signIn", email, password });
      } catch (cause) {
        throw authError(cause, "INVALID_CREDENTIALS");
      }
      await settleSignIn(client);
    },
  });
}

export function useRegister() {
  const { signIn } = useAuthActions();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ email, password, username }: RegisterInput) => {
      try {
        await signIn("password", { flow: "signUp", email, password, username });
      } catch (cause) {
        throw authError(cause, "REQUEST_FAILED");
      }
      await settleSignIn(client);
      return { data: { confirmationRequired: false } };
    },
  });
}

export function useLogout() {
  const { signOut } = useAuthActions();
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => signOut(),
    onSuccess: async () => {
      await client.cancelQueries({ queryKey: ["social"] });
      client.removeQueries({ queryKey: ["social"] });
      client.setQueryData(meQuery.queryKey, null);
    },
  });
}

const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** Emails an 8-digit reset code (convex/passwordReset.ts). */
export function useForgotPassword() {
  const { signIn } = useAuthActions();
  return useMutation({
    mutationFn: async (email: string) => {
      try {
        await signIn("password", {
          flow: "reset",
          email: normalizeEmail(email),
        });
      } catch (cause) {
        // An email without an account fails too. Report only our own errors
        // (send limits, email outages) so the form never reveals who has an
        // account.
        if (cause instanceof ConvexError) throw toApiError(cause);
      }
    },
  });
}

/** Checks the code, sets the new password, and signs the person in. */
export function useResetPassword() {
  const { signIn } = useAuthActions();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ email, code, password }: ResetPasswordInput) => {
      try {
        await signIn("password", {
          flow: "reset-verification",
          email: normalizeEmail(email),
          code,
          newPassword: password,
        });
      } catch (cause) {
        if (cause instanceof ConvexError) throw toApiError(cause);
        throw toApiError(new ConvexError({ code: "INVALID_RESET_CODE" }));
      }
      await settleSignIn(client);
    },
  });
}

// ------------------------------------------------------------ shows

export function useLiveShow(username: string) {
  return useQuery({
    ...convexQuery(api.shows.liveByUsername, username ? { username } : "skip"),
    select: (show) => (show ? toShow(show) : null),
  });
}

export function useCurrentShow() {
  return useQuery({
    ...convexQuery(api.shows.current, {}),
    select: (show) => (show ? toShow(show) : null),
  });
}

export function useCreateShow() {
  return useMutation({
    mutationFn: async () => {
      await runMutation(api.shows.create, {});
      const show = await runQuery(api.shows.current, {});
      return toShow(show!);
    },
  });
}

export function useStartShow(_username: string) {
  return useMutation({
    mutationFn: async (id: string) =>
      toShow(await runMutation(api.shows.start, { showId: showId(id) })),
  });
}

export function useEndShow(_username: string) {
  return useMutation({
    mutationFn: async (id: string) =>
      toShow(await runMutation(api.shows.end, { showId: showId(id) })),
  });
}

export function useTierConfiguration(id: string) {
  return useQuery({
    ...convexQuery(api.tiers.forCreator, id ? { showId: showId(id) } : "skip"),
    select: (tiers) => tiers.map(toTier),
  });
}

export function useSaveTierConfiguration(id: string) {
  return useMutation({
    mutationFn: async (tiers: HotlineTierInput[]) =>
      (await runMutation(api.tiers.replace, { showId: showId(id), tiers })).map(
        toTier,
      ),
  });
}

// ------------------------------------------------------------ queue

export function useQueueTiers(id: string) {
  return useQuery({
    ...convexQuery(api.tiers.forLiveShow, id ? { showId: showId(id) } : "skip"),
    select: (tiers) => tiers.map(toQueueTier),
  });
}

export function useViewerQueue(id: string) {
  const { isAuthenticated } = useConvexAuth();
  return useQuery({
    ...convexQuery(
      api.queue.mine,
      id && isAuthenticated ? { showId: showId(id) } : "skip",
    ),
    select: (entry) => (entry ? { entry: toEntry(entry) } : null),
  });
}

export function useJoinQueue(id: string) {
  const ensureSession = useEnsureSession();
  return useMutation({
    mutationFn: async (input: {
      displayName: string;
      topic: string;
      tierId: string;
      paymentAttemptId?: string;
    }) => {
      await ensureSession();
      const args = {
        showId: showId(id),
        tierId: (input.tierId || undefined) as Id<"showTiers"> | undefined,
        displayName: input.displayName,
        topic: input.topic,
      };
      const entry = input.paymentAttemptId
        ? await runAction(api.queue.joinPaid, {
            ...args,
            paymentAttemptId: input.paymentAttemptId as Id<"paymentAttempts">,
          })
        : await runMutation(api.queue.join, args);
      return { entry: toEntry(entry) };
    },
  });
}

export function useLeaveQueue(id: string) {
  return useMutation({
    mutationFn: () => runMutation(api.queue.leave, { showId: showId(id) }),
  });
}

export function useCreatorQueue(id: string) {
  return useQuery({
    ...convexQuery(api.queue.waiting, id ? { showId: showId(id) } : "skip"),
    select: (entries) => entries.map(toEntry),
  });
}

/** Convex queries are live, so there is no event socket to hold open. */
export function useQueueEvents(
  _showID: string,
  _audience: "viewer" | "creator",
  _enabled: boolean,
) {}

// ------------------------------------------------------------ calls

export function useActiveCall(id: string) {
  return useQuery({
    ...convexQuery(api.calls.active, id ? { showId: showId(id) } : "skip"),
    select: (call) => (call ? toCall(call) : null),
  });
}

export function useViewerCall(id: string) {
  const { isAuthenticated } = useConvexAuth();
  return useQuery({
    ...convexQuery(
      api.calls.mine,
      id && isAuthenticated ? { showId: showId(id) } : "skip",
    ),
    select: (call) => (call ? toCall(call) : null),
  });
}

export function useSelectCaller(id: string) {
  return useMutation({
    mutationFn: async (entryId?: string) =>
      toCall(
        await runMutation(api.calls.select, {
          showId: showId(id),
          entryId: entryId as Id<"queueEntries">,
        }),
      ),
  });
}

export function useSelectRandomCaller(id: string) {
  return useMutation({
    mutationFn: async (_entryId?: string) =>
      toCall(await runMutation(api.calls.selectRandom, { showId: showId(id) })),
  });
}

type ParticipantStatus = "CONNECTING" | "LIVE" | "ENDED" | "FAILED";

export async function transitionCall(callID: string, status: CallStatus) {
  return toCall(
    await runMutation(api.calls.transition, {
      callId: callID as Id<"calls">,
      status: status as ParticipantStatus,
    }),
  );
}

export function useTransitionCall(_showID: string) {
  return useMutation({
    mutationFn: ({ callID, status }: { callID: string; status: CallStatus }) =>
      transitionCall(callID, status),
  });
}

export async function rtcConfig(callID: string) {
  return runAction(api.rtc.config, { callId: callID as Id<"calls"> });
}

// ------------------------------------------------------------ payments

function paymentKey(id: string, tierID: string) {
  const storageKey = `bling:payment:${id}:${tierID}:key`;
  let value = sessionStorage.getItem(storageKey);
  if (!value) {
    value = crypto.randomUUID();
    sessionStorage.setItem(storageKey, value);
  }
  return { storageKey, value };
}

export function useAuthorizePayment(id: string) {
  const ensureSession = useEnsureSession();
  return useMutation({
    mutationFn: async (tierID: string) => {
      await ensureSession();
      const key = paymentKey(id, tierID);
      const result = await runAction(api.payments.authorize, {
        showId: showId(id),
        tierId: tierID as Id<"showTiers">,
        idempotencyKey: key.value,
      });
      return { ...result, storageKey: key.storageKey };
    },
  });
}

const paymentMethodsKey = ["me", "payment-methods"] as const;

export function usePaymentMethods() {
  return useQuery({
    queryKey: paymentMethodsKey,
    queryFn: () => runAction(api.paymentMethods.list, {}),
    staleTime: 15_000,
  });
}

export function usePaymentMethodSetup() {
  return useMutation({
    mutationFn: () => runAction(api.paymentMethods.setup, {}),
  });
}

export function useRemovePaymentMethod() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (paymentMethodId: string) =>
      runAction(api.paymentMethods.remove, { paymentMethodId }),
    onSuccess: () => client.invalidateQueries({ queryKey: paymentMethodsKey }),
  });
}

export function useRefreshPaymentMethods() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: paymentMethodsKey });
}

export function usePaymentActivity() {
  return useQuery({
    queryKey: ["payments", "activity"],
    queryFn: async (): Promise<{
      activity: PaymentActivity[];
      payoutFailure: PayoutFailure | null;
    }> => {
      const [activity, failure] = await Promise.all([
        runQuery(api.payments.activity, {}),
        runQuery(api.payouts.latestFailure, {}),
      ]);
      return {
        activity: activity.map((row) => ({
          ...row,
          paymentAttemptId: row.paymentAttemptId,
          createdAt: iso(row.createdAt)!,
        })),
        payoutFailure: failure && { ...failure, updatedAt: iso(Date.now())! },
      };
    },
    staleTime: 10_000,
  });
}

// ------------------------------------------------------------ payouts

export function usePayoutStatus() {
  return useQuery({
    queryKey: ["payouts", "account"],
    queryFn: async (): Promise<PayoutStatus> => {
      const status = await runAction(api.payouts.status, {});
      return { ...status, chargesEnabled: status.transfersStatus === "active" };
    },
    staleTime: 5_000,
  });
}

export function useCreatorBalance() {
  return useQuery({
    ...convexQuery(api.payouts.balance, {}),
    select: ({ balance, activity }) => ({
      balance: {
        ...balance,
        nextPayoutAt: iso(balance.nextPayoutAt) ?? undefined,
      },
      activity: activity.map((entry) => ({
        id: entry._id,
        kind: entry.kind,
        amountCents: entry.amountCents,
        currency: entry.currency,
        effectiveAt: iso(entry.effectiveAt)!,
        createdAt: iso(entry.createdAt)!,
      })),
    }),
  });
}

export function fetchPayoutAccountSession() {
  return runAction(api.payouts.accountSession, {});
}

export function usePayoutAccountSession() {
  return useMutation({ mutationFn: fetchPayoutAccountSession });
}

// ------------------------------------------------------------ social

export function useCreators(filters: DiscoveryFilters = {}) {
  const me = useMe();
  const q = filters.q?.trim() || "";
  const live = Boolean(filters.live);
  return useInfiniteQuery({
    queryKey: [
      "social",
      filters.following ? "following" : "directory",
      { q, live },
      me.data?.id ?? "guest",
    ],
    queryFn: async ({ pageParam }): Promise<CreatorPage> => {
      if (filters.following) {
        const page = await runQuery(api.directory.following, {
          live,
          offset: Number(pageParam || 0),
        });
        return {
          items: page.items.map(toProfile),
          nextCursor:
            page.nextOffset === undefined ? undefined : String(page.nextOffset),
        };
      }
      if (q) {
        const page = await runQuery(api.directory.search, {
          query: q,
          live,
          offset: Number(pageParam || 0),
        });
        return {
          items: page.items.map(toProfile),
          nextCursor:
            page.nextOffset === undefined ? undefined : String(page.nextOffset),
        };
      }
      const page = await runQuery(api.directory.list, {
        live,
        paginationOpts: { numItems: 24, cursor: pageParam || null },
      });
      return {
        items: page.page.map(toProfile),
        nextCursor: page.isDone ? undefined : page.continueCursor,
      };
    },
    initialPageParam: "",
    getNextPageParam: (page) => page.nextCursor || undefined,
    enabled: !me.isPending && (!filters.following || Boolean(me.data)),
    staleTime: 15_000,
    refetchInterval: 30_000,
    maxPages: 10,
  });
}

export function useCreatorProfile(username: string) {
  return useQuery({
    ...convexQuery(api.profiles.get, username ? { username } : "skip"),
    select: (profile) => (profile ? toProfile(profile) : null),
  });
}

export function useOwnProfile() {
  const me = useMe();
  return useQuery({
    ...convexQuery(api.profiles.mine, me.data ? {} : "skip"),
    select: toProfile,
  });
}

export function useSaveProfile() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: ProfileInput) =>
      toProfile(await runMutation(api.profiles.save, input)),
    onSuccess: () => client.invalidateQueries({ queryKey: ["social"] }),
  });
}

/** Uploads to Convex storage and attaches the file; returns its URL. */
export function useUploadAvatar() {
  return useMutation({
    mutationFn: async (file: File) => {
      const uploadUrl = await runMutation(api.profiles.avatarUploadUrl, {});
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!response.ok) {
        throw new ApiError(
          response.status,
          "UPLOAD_FAILED",
          "The upload failed. Try again.",
        );
      }
      const { storageId } = (await response.json()) as {
        storageId: Id<"_storage">;
      };
      return (await runAction(api.profiles.setAvatar, { storageId })).avatarUrl;
    },
  });
}

export function useFollowingCount() {
  const me = useMe();
  return useQuery({
    ...convexQuery(api.follows.followingCount, me.data ? {} : "skip"),
    select: ({ count }) => count,
  });
}

export function followRequest(username: string, following: boolean) {
  return runMutation(following ? api.follows.follow : api.follows.unfollow, {
    username,
  });
}

export function useNotifications() {
  const me = useMe();
  return useInfiniteQuery({
    queryKey: ["social", "notifications", me.data?.id],
    queryFn: async ({ pageParam }): Promise<NotificationPage> => {
      const page = await runQuery(api.notifications.list, {
        before: pageParam ? Number(pageParam) : undefined,
      });
      return {
        items: page.items.map((item) => ({
          ...item,
          id: item._id,
          createdAt: iso(item.createdAt)!,
        })),
        nextCursor: page.before === undefined ? undefined : String(page.before),
        unreadCount: page.unreadCount,
        unreadCapped: page.unreadCapped,
      };
    },
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
      runMutation(api.notifications.markRead, {
        ids: ids as Id<"liveEvents">[],
      }),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["social", "notifications"] }),
  });
}

/**
 * Counts this browser on a live channel page (anonymously if need be).
 * The count itself arrives through the live profile query.
 */
export function useChannelPresence(username: string, live: boolean) {
  const ensureSession = useEnsureSession();
  useEffect(() => {
    if (!live || !username) return;
    let busy = false;
    const beat = async () => {
      if (document.visibilityState !== "visible" || busy) return;
      busy = true;
      try {
        await ensureSession();
        await runMutation(api.channels.heartbeat, { username });
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
    };
  }, [username, live, ensureSession]);
}
