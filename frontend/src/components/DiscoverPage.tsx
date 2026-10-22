import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowRight, Heart, Phone, Search, Users } from "lucide-react";
import { useMe } from "../lib/auth";
import {
  creatorItems,
  followerLabel,
  formatCount,
  useCreators,
  type CreatorProfile,
} from "../lib/social";
import { FollowButton } from "./FollowButton";
import { CreatorAvatar, CreatorCover } from "./CreatorIdentity";
import { ViewerShell } from "./ViewerShell";
import { HomeIntro } from "./info/HomeIntro";
import { CreatorCallout, QuietNotice, TopicBar } from "./info/DiscoverExtras";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Grid, GridItem } from "./Grid";
import { PageHeader, SectionHeader } from "./page";
import { useScreenSize } from "../lib/design";
import { cn } from "@/lib/utils";

function LivePill({ live }: { live: boolean }) {
  return (
    <Badge
      variant={live ? "default" : "secondary"}
      className="gap-1.5 rounded-full px-2.5 py-1 text-(length:--text-eyebrow) tracking-[0.1em] uppercase"
    >
      {live && <span className="bg-primary-foreground size-1.5 rounded-full" />}
      {live ? "Live" : "Offline"}
    </Badge>
  );
}

/** "@name · 12 followers · Advice", the line under a creator's name. */
function creatorMeta(creator: CreatorProfile) {
  return [
    `@${creator.username}`,
    followerLabel(creator.followerCount),
    creator.topics?.[0],
  ]
    .filter(Boolean)
    .join(" · ");
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
            className="text-on-media absolute top-3 right-3 flex items-center gap-1 rounded-full bg-black/50 px-2 py-1 text-(length:--text-eyebrow) font-semibold text-white"
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
            {creatorMeta(creator)}
          </p>
        </div>
        <FollowButton profile={creator} compact />
      </div>
    </Card>
  );
}

// Phone layout: one compact row per creator so a screen shows a list, not a
// single poster. Tablet and up use CreatorCard.
function CreatorRow({ creator }: { creator: CreatorProfile }) {
  return (
    <li className="flex items-center gap-3 px-(--card-pad) py-3">
      <Link
        to={`/u/${creator.username}`}
        aria-label={`Visit ${creator.displayName}`}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        <CreatorAvatar
          profile={creator}
          className={cn(
            "size-12",
            creator.isLive &&
              "ring-primary ring-offset-card ring-2 ring-offset-2",
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <strong className="truncate text-(length:--text-body) font-semibold">
              {creator.displayName}
            </strong>
            {creator.isLive && <LivePill live />}
          </span>
          <span className="text-muted-foreground block truncate text-(length:--text-meta)">
            {creatorMeta(creator)}
          </span>
        </span>
      </Link>
      <FollowButton profile={creator} compact />
    </li>
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
  const { isPhone } = useScreenSize();
  const browsing = view === "home" && !query && !liveOnly;
  const quiet =
    browsing && !discovery.isPending && items.length > 0 && !feature;

  return (
    <ViewerShell>
      {view === "home" && !query && !me.data ? (
        <HomeIntro />
      ) : (
        <PageHeader
          title={
            view === "following"
              ? "Your people. Your place."
              : "Talk live with creators."
          }
          description={
            view === "following"
              ? "The creators you follow, together in one feed."
              : "Ask to call anyone who's live. They pick who they talk to."
          }
        />
      )}

      {view === "home" && <TopicBar query={query} />}

      {quiet && <QuietNotice creators={items} signedIn={!!me.data} />}

      {view === "home" && !query && feature && (
        <Card
          className="gap-0 overflow-hidden border-[var(--mauve-border)] bg-[var(--mauve-surface)] py-0"
          aria-label="Featured creator"
        >
          <Grid gap="none">
            <GridItem
              span={7}
              tablet={8}
              phone={4}
              className="flex flex-col gap-(--card-gap) p-(--card-pad) laptop:p-(--space-7)"
            >
              <LivePill live />
              <div className="flex items-center gap-4">
                <CreatorAvatar profile={feature} className="size-14" />
                <div className="min-w-0">
                  <h2 className="truncate text-(length:--text-page-title) font-extrabold tracking-tight">
                    {feature.displayName}
                  </h2>
                  <p className="text-muted-foreground text-sm">
                    {creatorMeta(feature)}
                  </p>
                </div>
              </div>
              {feature.bio && (
                <p className="text-muted-foreground max-w-prose text-sm">
                  {feature.bio}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <Button asChild size="lg" className="flex-1 tablet:flex-none">
                  <Link to={`/u/${feature.username}`}>
                    <Phone className="size-4" />
                    Join the line
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
              className="relative aspect-[16/9] tablet:aspect-auto tablet:min-h-[240px]"
            >
              <CreatorCover profile={feature} />
            </GridItem>
          </Grid>
        </Card>
      )}

      <section id="creators" aria-label="Creator discovery">
        <div className="mb-(--stack-gap) flex items-end justify-between gap-4">
          <SectionHeader
            title={
              query
                ? `Results for “${query}”`
                : view === "following"
                  ? "From your following"
                  : liveOnly
                    ? "Live now"
                    : "Popular on Bling"
            }
            description={
              liveOnly
                ? "Creators taking calls right now."
                : "Live creators first, then the most followed."
            }
          />
          <Label className="flex shrink-0 cursor-pointer items-center gap-2 text-(length:--text-meta) font-semibold">
            <Switch
              checked={liveOnly}
              onCheckedChange={(checked) =>
                setParams((current) => {
                  const next = new URLSearchParams(current);
                  if (checked) next.set("live", "true");
                  else next.delete("live");
                  return next;
                })
              }
            />
            Live only
          </Label>
        </div>

        {signedOut ? (
          <Card className="items-center gap-3 px-(--card-pad) py-(--space-9) text-center">
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
          <Card
            className="items-center gap-3 px-(--card-pad) py-(--space-9) text-center"
            role="alert"
          >
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
            className="text-muted-foreground items-center px-(--card-pad) py-(--space-9) text-center text-sm"
            role="status"
          >
            Finding your next conversation…
          </Card>
        ) : items.length ? (
          <>
            {isPhone ? (
              <Card className="gap-0 py-0">
                <ul className="divide-y">
                  {items.map((creator) => (
                    <CreatorRow key={creator.id} creator={creator} />
                  ))}
                </ul>
              </Card>
            ) : (
              <Grid>
                {items.map((creator) => (
                  <GridItem key={creator.id} span={4} tablet={4} wide={3}>
                    <CreatorCard creator={creator} />
                  </GridItem>
                ))}
              </Grid>
            )}
            {discovery.hasNextPage && (
              <div className="mt-(--stack-gap) flex justify-center">
                <Button
                  variant="secondary"
                  className="w-full tablet:w-auto"
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
          <Card className="items-center gap-3 px-(--card-pad) py-(--space-9) text-center">
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
                : query
                  ? `No one's talking about “${query}” yet.`
                  : liveOnly
                    ? "No one's live right now."
                    : "A new conversation starts with you."}
            </h2>
            <p className="text-muted-foreground max-w-md text-sm">
              {view === "following"
                ? "Follow creators to build your feed, or clear your filters to see more."
                : query
                  ? "Try another topic above, or open your own Hotline and be the first."
                  : liveOnly
                    ? "Turn off Live only to see every creator, and follow the ones you like to hear when they go live."
                    : "No creators match these filters yet. Clear your filters or open your own Hotline."}
            </p>
            <Button asChild>
              <Link to="/">
                Explore all creators
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild variant="link">
              <Link to={me.data ? "/dashboard" : "/register"}>
                {me.data ? "Open creator studio" : "Open your Hotline"}
              </Link>
            </Button>
          </Card>
        )}
      </section>

      {browsing && !me.data && !me.isPending && <CreatorCallout />}
    </ViewerShell>
  );
}

// Preserve previously shared discovery links, now backed by real channels.
export function LegacyCreatorRedirect() {
  const { username = "" } = useParams();
  return <Navigate replace to={`/u/${encodeURIComponent(username)}`} />;
}
