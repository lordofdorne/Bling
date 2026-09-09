import { Link, useParams, useSearchParams } from "react-router-dom";
import { creators, portrait, type Creator } from "../data/discovery";
import { FollowButton } from "./SocialPreview";
import { usePreviewFollows } from "../ui/preview-follows";
import { ViewerShell } from "./ViewerShell";
import { UiIcon } from "./UiIcon";

const categories = [
  "All",
  "Just chatting",
  "Music",
  "Gaming",
  "Creative",
  "Tech",
];
const categoryIcons = [
  "discover",
  "call",
  "music",
  "gaming",
  "spark",
  "code",
] as const;
function CreatorCard({ creator }: { creator: Creator }) {
  return (
    <article className="creator-card">
      <Link
        className={`creator-cover cover-${creator.color}`}
        to={`/discover/${creator.username}`}
        aria-label={`Visit ${creator.name}`}
      >
        <img src={portrait(creator)} alt={creator.name} loading="lazy" />
        <div className="cover-shade" />
        <span className={creator.live ? "live-pill" : "offline-pill"}>
          {creator.live ? "LIVE" : "OFFLINE"}
        </span>
        <span className="cover-topic">{creator.tag}</span>
        {creator.live && (
          <span className="viewer-count">
            <UiIcon name="people" size={13} />
            {creator.audience}
          </span>
        )}
        <span className="cover-arrow">
          <UiIcon name="arrow" />
        </span>
      </Link>
      <div className="creator-details">
        <Link
          className="avatar-image"
          to={`/discover/${creator.username}`}
          aria-label={`${creator.name} profile`}
        >
          <img src={portrait(creator, 80)} alt="" loading="lazy" />
        </Link>
        <div className="creator-meta">
          <Link to={`/discover/${creator.username}`}>
            <h3>{creator.title}</h3>
          </Link>
          <span>
            {creator.name} <UiIcon name="verified" size={13} />
          </span>
          <small>
            {creator.category} <span>· English</span>
          </small>
        </div>
        <FollowButton username={creator.username} compact />
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
  const { following } = usePreviewFollows();
  const category = params.get("category") ?? "All";
  const liveOnly = params.get("live") === "true";
  const query = (params.get("q") ?? "").trim().toLowerCase();
  const filtered = creators.filter(
    (creator) =>
      (view !== "following" || following.includes(creator.username)) &&
      (category === "All" || creator.category === category) &&
      (!liveOnly || creator.live) &&
      (!query ||
        `${creator.name} ${creator.category} ${creator.title}`
          .toLowerCase()
          .includes(query)),
  );
  const savedChannels =
    view === "following" && category === "All" && !liveOnly
      ? following.filter(
          (username) =>
            !creators.some((creator) => creator.username === username) &&
            (!query || username.toLowerCase().includes(query)),
        )
      : [];
  const resultCount = filtered.length + savedChannels.length;
  const feature = creators[0];
  function chooseCategory(value: string) {
    setParams((current) => {
      const next = new URLSearchParams(current);
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
                : "Good company. Live now."}
          </h1>
          <p>
            {view === "following"
              ? "The creators you follow, together in one feed."
              : view === "browse"
                ? "Follow your curiosity. There’s a conversation for it."
                : "Find a conversation you love. Be a part of it."}
          </p>
        </div>
        <span className="preview-label">Discovery preview</span>
      </div>
      {view === "home" && !query && category === "All" && (
        <section className="featured-live" aria-label="Featured creator">
          <div className="featured-copy">
            <div className="featured-kicker">
              <span className="live-pill">LIVE</span>
              <span>In the spotlight</span>
            </div>
            <h2>
              Less scrolling.
              <br />
              More <em>connecting.</em>
            </h2>
            <p>{feature.description}</p>
            <div className="featured-person">
              <span className="avatar-image">
                <img src={portrait(feature, 80)} alt="" />
              </span>
              <span>
                <strong>
                  {feature.name} <UiIcon name="verified" size={14} />
                </strong>
                <small>Just chatting · {feature.audience} hanging out</small>
              </span>
            </div>
            <div className="featured-actions">
              <Link className="primary-button" to="/discover/maya">
                <UiIcon name="call" size={17} />
                Drop into the conversation
                <UiIcon name="arrow" size={17} />
              </Link>
              <FollowButton username="maya" />
            </div>
          </div>
          <div className="featured-visual">
            <img
              src={portrait(feature, 1000)}
              alt="Featured example creator Maya Chen"
            />
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
          </div>
        </section>
      )}
      <section className="feed-section" aria-label="Creator discovery">
        <div className="category-tabs" aria-label="Filter by category">
          {categories.map((item, index) => (
            <button
              className={category === item ? "selected" : ""}
              key={item}
              aria-pressed={category === item}
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
                ? `Results for “${params.get("q")}”`
                : view === "following"
                  ? "From your following"
                  : category !== "All"
                    ? category
                    : "Popular on Bling"}{" "}
              <span className="heading-dot">✦</span>
            </h2>
            <p>
              {view === "following"
                ? "Followed here. Ready when you are."
                : "Real people. Open lines. Something for everyone."}
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
            <span className="result-count">
              {resultCount} {resultCount === 1 ? "creator" : "creators"}
            </span>
          </div>
        </div>
        {resultCount ? (
          <div className="creator-grid">
            {filtered.map((creator) => (
              <CreatorCard key={creator.username} creator={creator} />
            ))}
            {savedChannels.map((username) => (
              <article className="saved-channel" key={username}>
                <span className="feature-icon">
                  <UiIcon name="broadcast" size={25} />
                </span>
                <h3>@{username}</h3>
                <p>
                  Saved to your following. Live status updates are coming soon.
                </p>
                <div>
                  <Link
                    className="button secondary"
                    to={`/u/${encodeURIComponent(username)}`}
                  >
                    Visit channel <UiIcon name="arrow" size={15} />
                  </Link>
                  <FollowButton username={username} compact />
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="discovery-empty">
            <span className="feature-icon">
              <UiIcon
                name={view === "following" ? "heart" : "search"}
                size={26}
              />
            </span>
            <h2>
              {view === "following" && !following.length
                ? "Make yourself at home."
                : "No creators found."}
            </h2>
            <p>
              {view === "following" && !following.length
                ? "Follow your favorite creators and their live conversations will appear here."
                : "Try another topic or clear your filters to explore more creators."}
            </p>
            <Link className="primary-button" to="/">
              Explore creators <UiIcon name="arrow" size={17} />
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
            Find your people <UiIcon name="arrow" size={16} />
          </Link>
        </section>
      )}
    </ViewerShell>
  );
}
export function CreatorPreview() {
  const { username } = useParams();
  const creator = creators.find((item) => item.username === username);
  if (!creator)
    return (
      <ViewerShell>
        <div className="discovery-empty">
          <h1>Creator not found.</h1>
          <Link className="primary-button" to="/">
            Explore creators
          </Link>
        </div>
      </ViewerShell>
    );
  return (
    <ViewerShell>
      <Link className="back-link" to="/">
        ← Back to discover
      </Link>
      <div className="profile-layout">
        <section>
          <div className={`profile-cover cover-${creator.color}`}>
            <img src={portrait(creator, 1000)} alt={creator.name} />
            <span className={creator.live ? "live-pill" : "offline-pill"}>
              {creator.live ? "LIVE PREVIEW" : "OFFLINE"}
            </span>
            <div className="profile-cover-copy">
              <span className="sound-bars">
                <i />
                <i />
                <i />
                <i />
                <i />
              </span>
              <h1>{creator.title}</h1>
              <span>{creator.category}</span>
            </div>
          </div>
          <div className="profile-heading">
            <div className="featured-person">
              <span className="avatar-image">
                <img src={portrait(creator, 100)} alt="" />
              </span>
              <div>
                <h2>
                  {creator.name} <UiIcon name="verified" size={18} />
                </h2>
                <p>@{creator.username}</p>
              </div>
            </div>
            <FollowButton username={creator.username} />
          </div>
          <section className="profile-about">
            <h3>About {creator.name.split(" ")[0]}</h3>
            <p>{creator.description}</p>
            <span className="topic-tag">{creator.tag}</span>
          </section>
        </section>
        <aside className="queue-card preview-queue">
          <span className="feature-icon">
            <UiIcon name="call" size={24} />
          </span>
          <p className="eyebrow">A conversation away</p>
          <h2>
            {creator.live
              ? "You’re in good company."
              : "Catch the next conversation."}
          </h2>
          <p>
            Follow {creator.name.split(" ")[0]} to add them to your feed and see
            their live updates.
          </p>
          <FollowButton username={creator.username} />
          <div className="preview-note">
            <UiIcon name="info" size={17} />
            <p>
              This is an example creator. Following is saved on this device;
              live calls and notifications will connect when discovery launches.
            </p>
          </div>
          <Link className="text-link" to="/following">
            See your following
          </Link>
        </aside>
      </div>
    </ViewerShell>
  );
}
