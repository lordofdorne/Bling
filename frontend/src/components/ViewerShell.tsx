import { useRef, useState, type ReactNode } from "react";
import { Link, NavLink, useNavigate, useSearchParams } from "react-router-dom";
import {
  creatorItems,
  formatCount,
  useCreators,
  useFollowingCount,
  useNotifications,
} from "../lib/social";
import { useMe } from "../lib/auth";
import { CreatorAvatar } from "./CreatorIdentity";
import { NotificationsPanel } from "./NotificationsPanel";
import { UiIcon } from "./UiIcon";

export function Brand() {
  return (
    <Link className="brand" to="/" aria-label="Bling home">
      <span className="brand-mark">
        <UiIcon name="spark" size={22} />
      </span>
      bling<span className="brand-period">.</span>
    </Link>
  );
}
export function ViewerShell({ children }: { children: ReactNode }) {
  const notificationButton = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const me = useMe();
  const following = useFollowingCount();
  const recommended = useCreators();
  const creators = creatorItems(recommended.data?.pages).slice(0, 5);
  const notifications = useNotifications();
  const unread = notifications.data?.pages[0]?.unreadCount ?? 0;
  const [params] = useSearchParams();
  const navigate = useNavigate();
  return (
    <div className="viewer-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="viewer-nav">
        <div className="nav-brand">
          <button
            type="button"
            className="icon-button mobile-menu"
            aria-label="Toggle navigation"
            aria-expanded={menuOpen}
            aria-controls="viewer-sidebar"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <UiIcon name={menuOpen ? "close" : "menu"} />
          </button>
          <Brand />
        </div>
        <form
          className="viewer-search"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            navigate(`/?q=${encodeURIComponent(String(data.get("q") ?? ""))}`);
          }}
        >
          <UiIcon name="search" size={18} />
          <input
            aria-label="Search creators and topics"
            name="q"
            placeholder="Search creators, conversations, and more"
            key={params.get("q")}
            defaultValue={params.get("q") ?? ""}
          />
          <button type="submit" aria-label="Search">
            <UiIcon name="arrow" size={17} />
          </button>
        </form>
        <div className="viewer-nav-actions">
          <Link className="studio-link" to="/dashboard">
            <UiIcon name="broadcast" size={17} />
            Creator studio
          </Link>
          <div
            className="notification-wrap"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setNotificationsOpen(false);
                notificationButton.current?.focus();
              }
            }}
          >
            <button
              type="button"
              className="icon-button"
              ref={notificationButton}
              aria-label="Live notifications"
              aria-controls={
                notificationsOpen ? "live-notifications" : undefined
              }
              aria-expanded={notificationsOpen}
              onClick={() => setNotificationsOpen(!notificationsOpen)}
            >
              <UiIcon name="bell" />
              {unread > 0 && <span className="notification-dot" />}
            </button>
            {notificationsOpen && (
              <section
                className="notification-popover"
                id="live-notifications"
                aria-label="Notifications"
              >
                <div className="section-heading">
                  <h3>Your live updates</h3>
                  <button
                    className="icon-button"
                    aria-label="Close notifications"
                    onClick={() => {
                      setNotificationsOpen(false);
                      notificationButton.current?.focus();
                    }}
                  >
                    <UiIcon name="close" size={16} />
                  </button>
                </div>
                <NotificationsPanel close={() => setNotificationsOpen(false)} />
              </section>
            )}
          </div>
          <Link
            className="button secondary nav-signin"
            to={me.data ? "/dashboard" : "/login?next=%2Ffollowing"}
          >
            {me.data ? me.data.username : "Sign in"}
          </Link>
        </div>
      </header>
      <div className="viewer-layout">
        <aside
          id="viewer-sidebar"
          className={`viewer-sidebar ${menuOpen ? "is-open" : ""}`}
          aria-label="Main navigation"
        >
          <div className="sidebar-top">
            <p className="nav-label">Discover</p>
            <NavLink to="/" end onClick={() => setMenuOpen(false)}>
              <UiIcon name="home" />
              For you
            </NavLink>
            <NavLink to="/following" onClick={() => setMenuOpen(false)}>
              <UiIcon name="heart" />
              Following
              {(following.data ?? 0) > 0 && (
                <span className="nav-count">{following.data}</span>
              )}
            </NavLink>
            <NavLink to="/browse" onClick={() => setMenuOpen(false)}>
              <UiIcon name="discover" />
              Browse categories
            </NavLink>
            <div className="sidebar-rule" />
            <div className="sidebar-section-heading">
              <p className="nav-label">Recommended</p>
              <UiIcon name="broadcast" size={14} />
            </div>
            {creators.map((creator) => (
              <Link
                className="sidebar-creator"
                to={`/u/${creator.username}`}
                key={creator.username}
                onClick={() => setMenuOpen(false)}
              >
                <CreatorAvatar profile={creator} />
                <span>
                  <strong>{creator.displayName}</strong>
                  <small>{creator.category}</small>
                </span>
                <span className="sidebar-audience">
                  {creator.isLive
                    ? "Live"
                    : `${formatCount(creator.followerCount)} followers`}
                </span>
              </Link>
            ))}
            {recommended.isPending && (
              <p className="sidebar-feedback" role="status">
                Loading creators…
              </p>
            )}
            {recommended.isError && (
              <button
                className="sidebar-feedback text-button"
                onClick={() => void recommended.refetch()}
              >
                Retry loading creators
              </button>
            )}
            {!recommended.isPending &&
              !recommended.isError &&
              creators.length === 0 && (
                <p className="sidebar-feedback">New voices are on their way.</p>
              )}
            <Link
              className="sidebar-more"
              to="/browse"
              onClick={() => setMenuOpen(false)}
            >
              Explore more <UiIcon name="arrow" size={14} />
            </Link>
          </div>
          <div className="sidebar-bottom">
            <div className="sidebar-promo">
              <span className="feature-icon">
                <UiIcon name="call" />
              </span>
              <h3>Your voice belongs here.</h3>
              <p>Turn your audience into a conversation.</p>
              <Link to="/register">
                Become a creator <UiIcon name="arrow" size={16} />
              </Link>
            </div>
            <div className="sidebar-footnote">
              <span>Bling © {new Date().getFullYear()}</span>
              <span>A little closer.</span>
            </div>
          </div>
        </aside>
        <main className="viewer-feed" id="main-content">
          {children}
          <footer className="viewer-footer">
            <span>
              <span className="live-dot" /> Made for real connection.
            </span>
            <span>Your voice. Your community.</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
