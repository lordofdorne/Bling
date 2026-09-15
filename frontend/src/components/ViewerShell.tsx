import { useRef, useState, type ReactNode } from "react";
import { Link, NavLink, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  Bell,
  Compass,
  Heart,
  Home,
  Menu,
  Phone,
  Radio,
  Search,
  Sparkles,
  X,
} from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export function Brand() {
  return (
    <Link
      className="flex items-center gap-2 text-2xl font-extrabold tracking-tight"
      to="/"
      aria-label="Bling home"
    >
      <span className="bg-primary text-primary-foreground grid size-8 place-items-center rounded-xl">
        <Sparkles className="size-[18px]" />
      </span>
      bling<span className="text-primary -ml-2">.</span>
    </Link>
  );
}

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition-colors",
    isActive
      ? "bg-primary/10 text-primary"
      : "text-muted-foreground hover:bg-accent hover:text-foreground",
  );

function SidebarNav({ onNavigate }: { onNavigate: () => void }) {
  const following = useFollowingCount();
  const recommended = useCreators();
  const creators = creatorItems(recommended.data?.pages).slice(0, 5);
  return (
    <div className="flex h-full flex-col justify-between gap-8 p-4">
      <nav className="flex flex-col gap-1">
        <p className="text-muted-foreground px-3 pb-2 text-[11px] font-bold tracking-[0.12em] uppercase">
          Discover
        </p>
        <NavLink to="/" end onClick={onNavigate} className={navLinkClass}>
          <Home className="size-[18px]" />
          For you
        </NavLink>
        <NavLink to="/following" onClick={onNavigate} className={navLinkClass}>
          <Heart className="size-[18px]" />
          Following
          {(following.data ?? 0) > 0 && (
            <span className="text-muted-foreground ml-auto text-xs font-semibold">
              {following.data}
            </span>
          )}
        </NavLink>
        <NavLink to="/browse" onClick={onNavigate} className={navLinkClass}>
          <Compass className="size-[18px]" />
          Browse categories
        </NavLink>

        <Separator className="my-4" />

        <div className="flex items-center justify-between px-3 pb-2">
          <p className="text-muted-foreground text-[11px] font-bold tracking-[0.12em] uppercase">
            Recommended
          </p>
          <Radio className="text-muted-foreground size-3.5" />
        </div>
        {creators.map((creator) => (
          <Link
            className="hover:bg-accent flex items-center gap-3 rounded-lg px-3 py-2 transition-colors"
            to={`/u/${creator.username}`}
            key={creator.username}
            onClick={onNavigate}
          >
            <CreatorAvatar profile={creator} className="size-8" />
            <span className="min-w-0 flex-1">
              <strong className="block truncate text-sm font-semibold">
                {creator.displayName}
              </strong>
              <small className="text-muted-foreground block truncate text-xs">
                {creator.category}
              </small>
            </span>
            <span
              className={cn(
                "shrink-0 text-xs font-semibold",
                creator.isLive ? "text-primary" : "text-muted-foreground",
              )}
            >
              {creator.isLive
                ? "Live"
                : `${formatCount(creator.followerCount)}`}
            </span>
          </Link>
        ))}
        {recommended.isPending && (
          <p className="text-muted-foreground px-3 py-2 text-sm" role="status">
            Loading creators…
          </p>
        )}
        {recommended.isError && (
          <Button
            variant="link"
            className="justify-start px-3"
            onClick={() => void recommended.refetch()}
          >
            Retry loading creators
          </Button>
        )}
        {!recommended.isPending &&
          !recommended.isError &&
          creators.length === 0 && (
            <p className="text-muted-foreground px-3 py-2 text-sm">
              New voices are on their way.
            </p>
          )}
        <Button asChild variant="link" className="justify-start px-3">
          <Link to="/browse" onClick={onNavigate}>
            Explore more <ArrowRight className="size-3.5" />
          </Link>
        </Button>
      </nav>

      <div className="flex flex-col gap-4">
        <div className="bg-[var(--mauve-surface)] border-[var(--mauve-border)] rounded-xl border p-4">
          <span className="bg-background text-primary mb-3 grid size-9 place-items-center rounded-lg">
            <Phone className="size-[18px]" />
          </span>
          <h3 className="text-sm font-semibold">Your voice belongs here.</h3>
          <p className="text-muted-foreground mt-1 text-xs">
            Turn your audience into a conversation.
          </p>
          <Button asChild variant="link" className="mt-2 h-auto px-0">
            <Link to="/register">
              Become a creator <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        </div>
        <div className="text-muted-foreground flex justify-between px-1 text-[11px]">
          <span>Bling © {new Date().getFullYear()}</span>
          <span>A little closer.</span>
        </div>
      </div>
    </div>
  );
}

export function ViewerShell({ children }: { children: ReactNode }) {
  const notificationButton = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const me = useMe();
  const notifications = useNotifications();
  const unread = notifications.data?.pages[0]?.unreadCount ?? 0;
  const [params] = useSearchParams();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen">
      <a
        className="sr-only focus:not-sr-only focus:bg-background focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:px-3 focus:py-2"
        href="#main-content"
      >
        Skip to content
      </a>

      <header className="bg-background/90 sticky top-0 z-40 flex h-[72px] items-center gap-4 border-b px-4 backdrop-blur md:px-6">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="laptop:hidden"
            aria-label="Toggle navigation"
            aria-expanded={menuOpen}
            aria-controls="viewer-sidebar"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? <X /> : <Menu />}
          </Button>
          <Brand />
        </div>

        <form
          className="relative mx-auto hidden w-full max-w-lg md:block"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            navigate(`/?q=${encodeURIComponent(String(data.get("q") ?? ""))}`);
          }}
        >
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            aria-label="Search creators and topics"
            name="q"
            placeholder="Search creators, conversations, and more"
            key={params.get("q")}
            defaultValue={params.get("q") ?? ""}
            className="bg-card h-10 rounded-full pr-10 pl-9"
          />
          <Button
            type="submit"
            variant="ghost"
            size="icon"
            aria-label="Search"
            className="absolute top-1/2 right-1 size-8 -translate-y-1/2 rounded-full"
          >
            <ArrowRight className="size-4" />
          </Button>
        </form>

        <div className="ml-auto flex items-center gap-1 md:gap-2">
          <Button asChild variant="ghost" className="hidden sm:inline-flex">
            <Link to="/dashboard">
              <Radio className="size-4" />
              Creator studio
            </Link>
          </Button>
          <div
            className="relative"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setNotificationsOpen(false);
                notificationButton.current?.focus();
              }
            }}
          >
            <Button
              variant="ghost"
              size="icon"
              ref={notificationButton}
              aria-label="Live notifications"
              aria-controls={
                notificationsOpen ? "live-notifications" : undefined
              }
              aria-expanded={notificationsOpen}
              onClick={() => setNotificationsOpen(!notificationsOpen)}
            >
              <Bell />
              {unread > 0 && (
                <span className="bg-primary absolute top-2 right-2 size-2 rounded-full" />
              )}
            </Button>
            {notificationsOpen && (
              <section
                className="bg-popover absolute right-0 z-50 mt-2 flex max-h-[70vh] w-[min(380px,calc(100vw-2rem))] flex-col gap-3 overflow-y-auto rounded-xl border p-4 shadow-lg"
                id="live-notifications"
                aria-label="Notifications"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Your live updates</h3>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label="Close notifications"
                    onClick={() => {
                      setNotificationsOpen(false);
                      notificationButton.current?.focus();
                    }}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
                <NotificationsPanel close={() => setNotificationsOpen(false)} />
              </section>
            )}
          </div>
          <Button asChild variant={me.data ? "secondary" : "default"}>
            <Link to={me.data ? "/dashboard" : "/login?next=%2Ffollowing"}>
              {me.data ? me.data.username : "Sign in"}
            </Link>
          </Button>
        </div>
      </header>

      <div className="flex">
        <aside
          id="viewer-sidebar"
          className="bg-card sticky top-[72px] hidden h-[calc(100vh-72px)] w-[260px] shrink-0 overflow-y-auto border-r laptop:block"
          aria-label="Main navigation"
        >
          <SidebarNav onNavigate={() => setMenuOpen(false)} />
        </aside>

        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetContent side="left" className="w-[280px] overflow-y-auto p-0">
            <SheetTitle className="sr-only">Main navigation</SheetTitle>
            <SidebarNav onNavigate={() => setMenuOpen(false)} />
          </SheetContent>
        </Sheet>

        <main className="min-w-0 flex-1" id="main-content">
          <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-10">
            {children}
            <footer className="text-muted-foreground mt-12 flex flex-wrap justify-between gap-2 border-t pt-6 text-xs">
              <span className="flex items-center gap-2">
                <span className="bg-primary size-2 rounded-full" /> Made for
                real connection.
              </span>
              <span>Your voice. Your community.</span>
            </footer>
          </div>
        </main>
      </div>
    </div>
  );
}
