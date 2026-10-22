import { Link } from "react-router-dom";
import { ArrowRight, BellRing, CalendarClock, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/page";
import { CreatorAvatar } from "@/components/CreatorIdentity";
import { formatDateTime } from "@/components/studio/format";
import { BETA, PAYOUT_TERMS } from "@/lib/site";
import { TOPICS } from "@/lib/topics";
import type { CreatorProfile } from "@/lib/social";
import { cn } from "@/lib/utils";

// Pieces of the home page that keep it useful while few creators are live:
// topics to browse, what's coming up, and an invitation to creators.

const creatorSharePercent = BETA.active
  ? BETA.creatorSharePercent
  : PAYOUT_TERMS.creatorSharePercent;

/** Browse chips. Each runs a search for its topic; the active one clears it. */
export function TopicBar({ query }: { query: string }) {
  const active = query.trim().toLowerCase();
  return (
    <nav aria-label="Browse by topic" className="min-w-0">
      <ul className="-mx-(--page-pad) flex gap-2 overflow-x-auto px-(--page-pad) [scrollbar-width:none] tablet:mx-0 tablet:flex-wrap tablet:overflow-visible tablet:px-0">
        {TOPICS.map((topic) => {
          const selected = active === topic.toLowerCase();
          return (
            <li key={topic} className="shrink-0">
              <Button
                asChild
                size="sm"
                variant={selected ? "default" : "outline"}
                className="rounded-full"
              >
                <Link
                  to={selected ? "/" : `/?q=${encodeURIComponent(topic)}`}
                  aria-current={selected ? "page" : undefined}
                >
                  {topic}
                </Link>
              </Button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Shown on the home page when nobody is live: the Hotlines creators have
 * announced, soonest first, or a nudge to follow and get an alert.
 */
export function QuietNotice({
  creators,
  signedIn,
}: {
  creators: CreatorProfile[];
  signedIn: boolean;
}) {
  const upcoming = creators
    .filter((creator) => creator.nextHotlineAt)
    .sort(
      (a, b) =>
        new Date(a.nextHotlineAt!).getTime() -
        new Date(b.nextHotlineAt!).getTime(),
    )
    .slice(0, 3);

  return (
    <Card className="gap-0 py-0" aria-labelledby="quiet-notice-title">
      <div className="flex gap-3 p-(--card-pad)">
        <span className="bg-muted text-primary grid size-(--icon-button) shrink-0 place-items-center rounded-lg">
          {upcoming.length ? (
            <CalendarClock className="size-5" aria-hidden="true" />
          ) : (
            <BellRing className="size-5" aria-hidden="true" />
          )}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2
            id="quiet-notice-title"
            className="text-(length:--text-card-title) font-bold"
          >
            No one's live right now.
          </h2>
          <p className="text-muted-foreground text-(length:--text-body)">
            {upcoming.length
              ? "Here's who's opening their Hotline next. Follow them and we'll email you when they go live."
              : "Follow a few creators and we'll email you the moment they go live."}
          </p>
        </div>
      </div>
      {upcoming.length > 0 && (
        <ul className="divide-y border-t">
          {upcoming.map((creator) => (
            <li key={creator.id}>
              <Link
                to={`/u/${creator.username}`}
                className="hover:bg-accent flex min-h-(--touch-min) items-center gap-3 px-(--card-pad) py-(--inset-pad) transition-colors"
              >
                <CreatorAvatar profile={creator} className="size-8" />
                <span className="min-w-0 flex-1 truncate text-(length:--text-body) font-semibold">
                  {creator.displayName}
                </span>
                <span className="text-muted-foreground shrink-0 text-(length:--text-meta)">
                  {formatDateTime(creator.nextHotlineAt!)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {!signedIn && (
        <div className="border-t px-(--card-pad) py-(--inset-pad)">
          <Button asChild variant="link" className="h-auto px-0">
            <Link to="/register">
              Make a free account to follow creators
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      )}
    </Card>
  );
}

/** The home page's invitation to creators, for visitors who aren't one. */
export function CreatorCallout({ className }: { className?: string }) {
  return (
    <section
      aria-labelledby="creator-callout-title"
      className={cn("flex flex-col gap-(--stack-gap)", className)}
    >
      <Card className="gap-(--card-gap) border-[var(--mauve-border)] bg-[var(--mauve-surface)]">
        <div className="flex gap-3 px-(--card-pad)">
          <span className="bg-background text-primary grid size-(--icon-button) shrink-0 place-items-center rounded-lg">
            <Radio className="size-5" aria-hidden="true" />
          </span>
          <SectionHeader
            title={
              <span id="creator-callout-title">
                {BETA.active
                  ? "Be one of the first creators on Bling."
                  : "Turn your audience into a conversation."}
              </span>
            }
            description={`Free to start, with no monthly fee. Take calls one-on-one or on your stream, set your own prices, and keep ${creatorSharePercent}% of every paid call${BETA.active ? " — the beta rate, locked in when you join" : ""}.`}
          />
        </div>
        <div className="flex flex-col gap-2 px-(--card-pad) tablet:flex-row">
          <Button
            asChild
            variant="secondary"
            size="lg"
            className="w-full tablet:w-auto"
          >
            <Link to="/pricing">See pricing</Link>
          </Button>
          <Button asChild size="lg" className="w-full tablet:w-auto">
            <Link to="/register">
              Open your Hotline
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </Card>
    </section>
  );
}
