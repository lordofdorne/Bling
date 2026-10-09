import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowRight, Heart, Phone, Search, Users } from "lucide-react";
import { useMe } from "../lib/auth";
import {
  creatorItems,
  formatCount,
  useCreators,
  type CreatorProfile,
} from "../lib/social";
import { FollowButton } from "./FollowButton";
import { CreatorAvatar, CreatorCover } from "./CreatorIdentity";
import { ViewerShell } from "./ViewerShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Grid, GridItem } from "./Grid";

function LivePill({ live }: { live: boolean }) {
  return (
    <Badge
      variant={live ? "default" : "secondary"}
      className="gap-1.5 rounded-full px-2.5 py-1 text-[10px] tracking-[0.1em] uppercase"
    >
      {live && <span className="bg-primary-foreground size-1.5 rounded-full" />}
      {live ? "Live" : "Offline"}
    </Badge>
  );
}

function CreatorCard({ creator }: { creator: CreatorProfile }) {
  return (
    <Card className="gap-0 overflow-hidden py-0 transition-shadow hover:shadow-lg">
      <Link
        className="group relative block aspect-[16/10] overflow-hidden"
        to={`/u/${creator.username}`}
        aria-label={`Visit ${creator.displayName}`}
      >
        <CreatorCover profile={creator} />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
        <span className="absolute top-3 left-3">
          <LivePill live={creator.isLive} />
        </span>
        {creator.isLive && creator.channelVisitors !== null && (
          <span
            className="text-on-media absolute top-3 right-3 flex items-center gap-1 rounded-full bg-black/50 px-2 py-1 text-[11px] font-semibold text-white"
            title="People on this channel page in the last 90 seconds"
          >
            <Users className="size-3" />
            {formatCount(creator.channelVisitors)} on page
          </span>
        )}
        <span className="absolute right-3 bottom-3 grid size-8 place-items-center rounded-full bg-white/15 text-white transition-transform group-hover:translate-x-0.5">
          <ArrowRight className="size-4" />
        </span>
      </Link>
      <div className="flex items-center gap-3 p-4">
        <Link
          to={`/u/${creator.username}`}
          aria-label={`${creator.displayName} profile`}
        >
          <CreatorAvatar profile={creator} />
        </Link>
        <div className="min-w-0 flex-1">
          <Link to={`/u/${creator.username}`}>
            <h3 className="truncate text-sm font-semibold">
              {creator.displayName}
            </h3>
          </Link>
          <p className="text-muted-foreground truncate text-xs">
            @{creator.username} · {formatCount(creator.followerCount)}{" "}
            {creator.followerCount === 1 ? "follower" : "followers"}
          </p>
        </div>
        <FollowButton profile={creator} compact />
      </div>
    </Card>
  );
}

export function DiscoverPage({
  view = "home",
}: {
  view?: "home" | "following";
}) {
  const [params, setParams] = useSearchParams();
  const me = useMe();
  const query = params.get("q") ?? "";
  const liveOnly = params.get("live") === "true";
  const discovery = useCreators({
    q: query,
    live: liveOnly,
    following: view === "following",
  });
  const items = creatorItems(discovery.data?.pages);
  const feature = items.find((p) => p.isLive);
  const signedOut = view === "following" && !me.isPending && !me.data;

  return (
    <ViewerShell>
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold tracking-tight md:text-4xl">
          {view === "following"
            ? "Your people. Your place."
            : "Good company. Real connection."}
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">
          {view === "following"
            ? "The creators you follow, together in one feed."
            : "Find a conversation you love. Be a part of it."}
        </p>
      </div>

      {view === "home" && !query && feature && (
        <Card
          className="mb-10 gap-0 overflow-hidden border-[var(--mauve-border)] bg-[var(--mauve-surface)] py-0"
          aria-label="Featured creator"
        >
          <Grid gap="none">
            <GridItem
              span={7}
              tablet={8}
              phone={4}
              className="flex flex-col gap-5 p-6 md:p-8"
            >
              <LivePill live />
              <div className="flex items-center gap-4">
                <CreatorAvatar profile={feature} className="size-14" />
                <div className="min-w-0">
                  <h2 className="truncate text-2xl font-extrabold tracking-tight md:text-3xl">
                    {feature.displayName}
                  </h2>
                  <p className="text-muted-foreground text-sm">
                    @{feature.username} · {formatCount(feature.followerCount)}{" "}
                    {feature.followerCount === 1 ? "follower" : "followers"}
                  </p>
                </div>
              </div>
              {feature.bio && (
                <p className="text-muted-foreground max-w-prose text-sm">
                  {feature.bio}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <Button asChild size="lg">
                  <Link to={`/u/${feature.username}`}>
                    <Phone className="size-4" />
                    Drop into the conversation
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
                <FollowButton profile={feature} />
              </div>
            </GridItem>
            <GridItem
              span={5}
              tablet={8}
              phone={4}
              className="relative min-h-[240px]"
            >
              <CreatorCover profile={feature} />
            </GridItem>
          </Grid>
        </Card>
      )}

      <section aria-label="Creator discovery">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold tracking-tight">
              {query
                ? `Results for “${query}”`
                : view === "following"
                  ? "From your following"
                  : "Popular on Bling"}
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Live creators first, then the most followed.
            </p>
          </div>
          <Button
            variant={liveOnly ? "secondary" : "outline"}
            size="sm"
            className="rounded-full"
            aria-pressed={liveOnly}
            onClick={() =>
              setParams((current) => {
                const next = new URLSearchParams(current);
                if (liveOnly) next.delete("live");
                else next.set("live", "true");
                return next;
              })
            }
          >
            <span className="bg-primary size-2 rounded-full" />
            Live now
          </Button>
        </div>

        {signedOut ? (
          <Card className="items-center gap-3 p-10 text-center">
            <span className="bg-muted text-primary grid size-12 place-items-center rounded-xl">
              <Heart className="size-6" />
            </span>
            <h2 className="text-xl font-bold">Your people are waiting.</h2>
            <p className="text-muted-foreground text-sm">
              Sign in to follow creators and see when they go live.
            </p>
            <Button asChild>
              <Link to="/login?next=%2Ffollowing">Sign in</Link>
            </Button>
            <Button asChild variant="link">
              <Link to="/register?next=%2Ffollowing">
                Create a viewer account
              </Link>
            </Button>
          </Card>
        ) : me.isError || (discovery.isError && !discovery.data) ? (
          <Card className="items-center gap-3 p-10 text-center" role="alert">
            <h2 className="text-xl font-bold">We couldn’t load creators.</h2>
            <p className="text-muted-foreground text-sm">
              Please try again in a moment.
            </p>
            <Button
              variant="secondary"
              onClick={() =>
                void (me.isError ? me.refetch() : discovery.refetch())
              }
            >
              Try again
            </Button>
          </Card>
        ) : discovery.isPending ? (
          <Card
            className="text-muted-foreground items-center p-10 text-center text-sm"
            role="status"
          >
            Finding your next conversation…
          </Card>
        ) : items.length ? (
          <>
            <Grid>
              {items.map((creator) => (
                <GridItem key={creator.id} span={4} tablet={4} phone={4}>
                  <CreatorCard creator={creator} />
                </GridItem>
              ))}
            </Grid>
            {discovery.hasNextPage && (
              <div className="mt-8 flex justify-center">
                <Button
                  variant="secondary"
                  disabled={discovery.isFetchingNextPage}
                  onClick={() => void discovery.fetchNextPage()}
                >
                  {discovery.isFetchingNextPage
                    ? "Loading…"
                    : "Load more creators"}
                </Button>
              </div>
            )}
            {discovery.isFetchNextPageError && (
              <p role="alert" className="text-destructive mt-4 text-sm">
                Couldn’t load more creators. Try again.
              </p>
            )}
          </>
        ) : (
          <Card className="items-center gap-3 p-10 text-center">
            <span className="bg-muted text-primary grid size-12 place-items-center rounded-xl">
              {view === "following" ? (
                <Heart className="size-6" />
              ) : (
                <Search className="size-6" />
              )}
            </span>
            <h2 className="text-xl font-bold">
              {view === "following"
                ? "Make yourself at home."
                : "A new conversation starts with you."}
            </h2>
            <p className="text-muted-foreground max-w-md text-sm">
              {view === "following"
                ? "Follow creators to build your feed, or clear your filters to see more."
                : "No creators match these filters yet. Clear your filters or open your own Hotline."}
            </p>
            <Button asChild>
              <Link to="/">
                Explore all creators
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild variant="link">
              <Link to="/dashboard">Open creator studio</Link>
            </Button>
          </Card>
        )}
      </section>
    </ViewerShell>
  );
}

// Preserve previously shared discovery links, now backed by real channels.
export function LegacyCreatorRedirect() {
  const { username = "" } = useParams();
  return <Navigate replace to={`/u/${encodeURIComponent(username)}`} />;
}
