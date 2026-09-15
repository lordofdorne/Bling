import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  Code2,
  Compass,
  Gamepad2,
  Heart,
  Music,
  Phone,
  Search,
  Sparkles,
  Users,
} from "lucide-react";
import { useMe } from "../lib/auth";
import {
  categories,
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
import { cn } from "@/lib/utils";

const categoryIcons = [Compass, Phone, Music, Gamepad2, Sparkles, Code2];

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
        <span className="absolute bottom-3 left-4 text-base font-semibold text-white">
          {creator.category}
        </span>
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
  view?: "home" | "following" | "browse";
}) {
  const [params, setParams] = useSearchParams();
  const me = useMe();
  const category = params.get("category") ?? "All";
  const query = params.get("q") ?? "";
  const liveOnly = params.get("live") === "true";
  const discovery = useCreators({
    q: query,
    category: category === "All" ? undefined : category,
    live: liveOnly,
    following: view === "following",
  });
  const items = creatorItems(discovery.data?.pages);
  const feature = items.find((p) => p.isLive);
  const signedOut = view === "following" && !me.isPending && !me.data;

  function chooseCategory(value: string) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("cursor");
      if (value === "All") next.delete("category");
      else next.set("category", value);
      return next;
    });
  }

  return (
    <ViewerShell>
      <div className="mb-8">
        <p className="text-[var(--sand-text)] text-xs font-bold tracking-[0.14em] uppercase">
          A little closer to your people
        </p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight md:text-4xl">
          {view === "following"
            ? "Your people. Your place."
            : view === "browse"
              ? "Find your corner."
              : "Good company. Real connection."}
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">
          {view === "following"
            ? "The creators you follow, together in one feed."
            : view === "browse"
              ? "Follow your curiosity. There’s a conversation for it."
              : "Find a conversation you love. Be a part of it."}
        </p>
      </div>

      {view === "home" && !query && category === "All" && feature && (
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
              <div className="flex items-center gap-3">
                <LivePill live />
                <span className="text-muted-foreground text-sm">
                  In the spotlight
                </span>
              </div>
              <h2 className="text-3xl leading-tight font-extrabold tracking-tight md:text-4xl">
                Less scrolling.
                <br />
                More{" "}
                <em className="text-[var(--sand-text)] not-italic">
                  connecting.
                </em>
              </h2>
              <p className="text-muted-foreground max-w-prose text-sm">
                {feature.bio ||
                  `The line is open. Join ${feature.displayName} for a real conversation.`}
              </p>
              <div className="flex items-center gap-3">
                <CreatorAvatar profile={feature} />
                <span>
                  <strong className="block text-sm font-semibold">
                    {feature.displayName}
                  </strong>
                  <small className="text-muted-foreground text-xs">
                    {feature.category} · {formatCount(feature.followerCount)}{" "}
                    followers
                  </small>
                </span>
              </div>
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
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
              <span className="absolute right-4 bottom-5 left-5 text-sm text-white/85">
                A seat at the conversation.
                <br />
                <strong className="text-white">
                  And it has your name on it.
                </strong>
              </span>
              <Badge
                variant="secondary"
                className="absolute top-4 right-4 gap-2 rounded-full px-3 py-1.5 text-[10px] tracking-[0.12em] uppercase"
              >
                <span className="bg-primary size-1.5 animate-pulse rounded-full" />
                The hotline is open
              </Badge>
            </GridItem>
          </Grid>
        </Card>
      )}

      <section aria-label="Creator discovery">
        <div
          className="mb-6 flex flex-wrap gap-2"
          aria-label="Filter by category"
        >
          {["All", ...categories].map((item, index) => {
            const Icon = categoryIcons[index];
            const selected = category === item;
            return (
              <Button
                key={item}
                variant={selected ? "secondary" : "ghost"}
                size="sm"
                aria-pressed={selected}
                className={cn(
                  "rounded-full border",
                  selected
                    ? "border-[var(--sand)] bg-[var(--sand)]/15 text-[var(--sand-text)]"
                    : "border-border text-muted-foreground",
                )}
                onClick={() => chooseCategory(item)}
              >
                <Icon className="size-4" />
                {item === "All"
                  ? view === "home"
                    ? "For you"
                    : "All categories"
                  : item}
              </Button>
            );
          })}
        </div>

        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight">
              {query
                ? `Results for “${query}”`
                : view === "following"
                  ? "From your following"
                  : category !== "All"
                    ? category
                    : "Popular on Bling"}
              <Sparkles className="text-primary size-4" />
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {view === "following"
                ? "Your follows are saved across your devices."
                : "Live creators first, then the most followed."}
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
                : "No creators match these filters yet. Explore all channels or open your own Hotline."}
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

      {view !== "following" && !query && (
        <Card className="mt-10 flex-row flex-wrap items-center gap-5 p-6">
          <span className="bg-muted text-primary grid size-14 shrink-0 place-items-center rounded-xl">
            <Phone className="size-7" />
          </span>
          <div className="min-w-[240px] flex-1">
            <p className="text-[var(--sand-text)] text-xs font-bold tracking-[0.14em] uppercase">
              Beyond the comments
            </p>
            <h2 className="mt-1 text-lg font-bold">
              Don’t just be in the audience. Be in the conversation.
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Your favorite creators are one call away.
            </p>
          </div>
          <Button asChild variant="secondary">
            <Link to="/following">
              Find your people
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </Card>
      )}
    </ViewerShell>
  );
}

// Preserve previously shared discovery links, now backed by real channels.
export function LegacyCreatorRedirect() {
  const { username = "" } = useParams();
  return <Navigate replace to={`/u/${encodeURIComponent(username)}`} />;
}
