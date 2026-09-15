import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
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
import { UiIcon } from "./UiIcon";
import { Grid, GridItem } from "./Grid";
import { useControlSize } from "../lib/useDesignTokens";

const categoryIcons = [
  "discover",
  "call",
  "music",
  "gaming",
  "spark",
  "code",
] as const;
function CreatorCard({ creator }: { creator: CreatorProfile }) {
  return (
    <article className="creator-card">
      <Link
        className={`creator-cover cover-${creator.category === "Music" ? "sage" : creator.category === "Gaming" ? "sand" : "lavender"}`}
        to={`/u/${creator.username}`}
        aria-label={`Visit ${creator.displayName}`}
      >
        <CreatorCover profile={creator} />
        <div className="cover-shade" />
        <span className={creator.isLive ? "live-pill" : "offline-pill"}>
          {creator.isLive ? "LIVE" : "OFFLINE"}
        </span>
        <span className="cover-topic">{creator.category}</span>
        {creator.isLive && creator.channelVisitors !== null && (
          <span
            className="viewer-count"
            title="People on this channel page in the last 90 seconds"
          >
            <UiIcon name="people" size={13} />
            {formatCount(creator.channelVisitors)} on page
          </span>
        )}
        <span className="cover-arrow">
          <UiIcon name="arrow" />
        </span>
      </Link>
      <div className="creator-details">
        <Link
          to={`/u/${creator.username}`}
          aria-label={`${creator.displayName} profile`}
        >
          <CreatorAvatar profile={creator} />
        </Link>
        <div className="creator-meta">
          <Link to={`/u/${creator.username}`}>
            <h3>{creator.displayName}</h3>
          </Link>
          <span>@{creator.username}</span>
          <small>
            {formatCount(creator.followerCount)}{" "}
            {creator.followerCount === 1 ? "follower" : "followers"}
          </small>
        </div>
        <FollowButton profile={creator} compact />
      </div>
    </article>
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
  const controlSize = useControlSize();
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
      <div className="feed-intro">
        <div>
          <p className="eyebrow">A little closer to your people</p>
          <h1>
            {view === "following"
              ? "Your people. Your place."
              : view === "browse"
                ? "Find your corner."
                : "Good company. Real connection."}
          </h1>
          <p>
            {view === "following"
              ? "The creators you follow, together in one feed."
              : view === "browse"
                ? "Follow your curiosity. There’s a conversation for it."
                : "Find a conversation you love. Be a part of it."}
          </p>
        </div>
      </div>
      {view === "home" && !query && category === "All" && feature && (
        <Grid
          as="section"
          gap="none"
          className="featured-live"
          aria-label="Featured creator"
        >
          <GridItem className="featured-copy" span={6} tablet={4} phone={4}>
            <div className="featured-kicker">
              <span className="live-pill">LIVE</span>
              <span>In the spotlight</span>
            </div>
            <h2>
              Less scrolling.
              <br />
              More <em>connecting.</em>
            </h2>
            <p>
              {feature.bio ||
                `The line is open. Join ${feature.displayName} for a real conversation.`}
            </p>
            <div className="featured-person">
              <CreatorAvatar profile={feature} />
              <span>
                <strong>{feature.displayName}</strong>
                <small>
                  {feature.category} · {formatCount(feature.followerCount)}{" "}
                  followers
                </small>
              </span>
            </div>
            <div className="featured-actions">
              <Link
                className={`primary-button${controlSize === "lg" ? " button-lg" : ""}`}
                to={`/u/${feature.username}`}
              >
                <UiIcon name="call" size={17} />
                Drop into the conversation
                <UiIcon name="arrow" size={17} />
              </Link>
              <FollowButton profile={feature} />
            </div>
          </GridItem>
          <GridItem className="featured-visual" span={6} tablet={4} phone={4}>
            <CreatorCover profile={feature} />
            <div className="featured-image-shade" />
            <span className="image-caption">
              A seat at the conversation.
              <br />
              <strong>And it has your name on it.</strong>
            </span>
            <div className="on-air-chip">
              <span className="sound-bars">
                <i />
                <i />
                <i />
                <i />
                <i />
              </span>
              THE HOTLINE IS OPEN
            </div>
          </GridItem>
        </Grid>
      )}
      <section className="feed-section" aria-label="Creator discovery">
        <div className="category-tabs" aria-label="Filter by category">
          {["All", ...categories].map((item, index) => (
            <button
              key={item}
              aria-pressed={category === item}
              className={category === item ? "selected" : ""}
              onClick={() => chooseCategory(item)}
            >
              <UiIcon name={categoryIcons[index]} size={16} />
              {item === "All"
                ? view === "home"
                  ? "For you"
                  : "All categories"
                : item}
            </button>
          ))}
        </div>
        <div className="section-heading">
          <div>
            <h2>
              {query
                ? `Results for “${query}”`
                : view === "following"
                  ? "From your following"
                  : category !== "All"
                    ? category
                    : "Popular on Bling"}{" "}
              <span className="heading-dot">✦</span>
            </h2>
            <p>
              {view === "following"
                ? "Your follows are saved across your devices."
                : "Live creators first, then the most followed."}
            </p>
          </div>
          <div className="discovery-controls">
            <button
              className={`live-filter ${liveOnly ? "selected" : ""}`}
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
              <span className="live-dot" />
              Live now
            </button>
          </div>
        </div>
        {signedOut ? (
          <div className="discovery-empty">
            <span className="feature-icon">
              <UiIcon name="heart" size={26} />
            </span>
            <h2>Your people are waiting.</h2>
            <p>Sign in to follow creators and see when they go live.</p>
            <Link className="primary-button" to="/login?next=%2Ffollowing">
              Sign in
            </Link>
            <Link className="text-link" to="/register?next=%2Ffollowing">
              Create a viewer account
            </Link>
          </div>
        ) : me.isError || (discovery.isError && !discovery.data) ? (
          <div className="discovery-empty" role="alert">
            <h2>We couldn’t load creators.</h2>
            <p>Please try again in a moment.</p>
            <button
              className="button secondary"
              onClick={() =>
                void (me.isError ? me.refetch() : discovery.refetch())
              }
            >
              Try again
            </button>
          </div>
        ) : discovery.isPending ? (
          <div className="discovery-empty" role="status">
            Finding your next conversation…
          </div>
        ) : items.length ? (
          <>
            <Grid className="creator-grid">
              {items.map((creator) => (
                <GridItem key={creator.id} span={4} wide={3}>
                  <CreatorCard creator={creator} />
                </GridItem>
              ))}
            </Grid>
            {discovery.hasNextPage && (
              <div className="load-more">
                <button
                  className="button secondary"
                  disabled={discovery.isFetchingNextPage}
                  onClick={() => void discovery.fetchNextPage()}
                >
                  {discovery.isFetchingNextPage
                    ? "Loading…"
                    : "Load more creators"}
                </button>
              </div>
            )}
            {discovery.isFetchNextPageError && (
              <p role="alert">Couldn’t load more creators. Try again.</p>
            )}
          </>
        ) : (
          <div className="discovery-empty">
            <span className="feature-icon">
              <UiIcon
                name={view === "following" ? "heart" : "search"}
                size={26}
              />
            </span>
            <h2>
              {view === "following"
                ? "Make yourself at home."
                : "A new conversation starts with you."}
            </h2>
            <p>
              {view === "following"
                ? "Follow creators to build your feed, or clear your filters to see more."
                : "No creators match these filters yet. Explore all channels or open your own Hotline."}
            </p>
            <Link className="primary-button" to="/">
              Explore all creators
              <UiIcon name="arrow" size={17} />
            </Link>
            <Link className="text-link" to="/dashboard">
              Open creator studio
            </Link>
          </div>
        )}
      </section>
      {view !== "following" && !query && (
        <section className="community-banner">
          <span className="community-symbol">
            <UiIcon name="call" size={32} />
          </span>
          <div>
            <p className="eyebrow">Beyond the comments</p>
            <h2>Don’t just be in the audience. Be in the conversation.</h2>
            <p>Your favorite creators are one call away.</p>
          </div>
          <Link className="button secondary" to="/following">
            Find your people
            <UiIcon name="arrow" size={16} />
          </Link>
        </section>
      )}
    </ViewerShell>
  );
}
// Preserve previously shared discovery links, now backed by real channels.
export function LegacyCreatorRedirect() {
  const { username = "" } = useParams();
  return <Navigate replace to={`/u/${encodeURIComponent(username)}`} />;
}
