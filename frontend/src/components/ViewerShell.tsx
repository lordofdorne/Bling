import { SiteFooter } from "./SiteFooter";
import { useRef, useState, type ReactNode } from "react";
import { Link, NavLink, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  Bell,
  Heart,
  Home,
  LogIn,
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
import {
  BottomNav,
  BOTTOM_NAV_CLEARANCE,
  type BottomNavItem,
} from "./BottomNav";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export function Brand() {
  return (
    <Link
      className="flex min-h-(--touch-min) items-center gap-2 text-2xl font-extrabold tracking-tight"
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
  const me = useMe();
  const following = useFollowingCount();
  const recommended = useCreators();
  const creators = creatorItems(recommended.data?.pages).slice(0, 5);
  return (
    <div className="flex h-full flex-col justify-between gap-8 p-4">
      <nav className="flex flex-col gap-1">
        <p className="text-muted-foreground px-3 pb-2 text-(length:--text-eyebrow) font-bold tracking-[0.12em] uppercase">
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

        <Separator className="my-4" />

        <p className="text-muted-foreground px-3 pb-2 text-(length:--text-eyebrow) font-bold tracking-[0.12em] uppercase">
          Recommended
        </p>
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
                @{creator.username}
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
      </nav>

      <div className="flex flex-col gap-4">
        {!me.data && (
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
        )}
        <p className="text-muted-foreground px-1 text-(length:--text-eyebrow)">
          Bling © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}

function SearchForm({
  autoFocus,
  className,
  onDone,
}: {
  autoFocus?: boolean;
  className?: string;
  onDone?: () => void;
}) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  return (
    <form
      className={cn("relative w-full", className)}
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        navigate(`/?q=${encodeURIComponent(String(data.get("q") ?? ""))}`);
        onDone?.();
      }}
    >
      <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
      <Input
        aria-label="Search creators and topics"
        name="q"
        type="search"
        enterKeyHint="search"
        placeholder="Search creators"
        autoFocus={autoFocus}
        key={params.get("q")}
        defaultValue={params.get("q") ?? ""}
        className="bg-card rounded-full pr-12 pl-9"
      />
      <Button
        type="submit"
        variant="ghost"
        size="icon"
        aria-label="Search"
        className="absolute top-1/2 right-0 -translate-y-1/2 rounded-full"
      >
        <ArrowRight className="size-4" />
      </Button>
    </form>
  );
}

export function ViewerShell({ children }: { children: ReactNode }) {
  const notificationButton = useRef<HTMLButtonElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const me = useMe();
  const notifications = useNotifications();
  const unread = notifications.data?.pages[0]?.unreadCount ?? 0;

  const navItems: BottomNavItem[] = [
    { to: "/", label: "Home", Icon: Home, end: true },
    { to: "/following", label: "Following", Icon: Heart },
    me.data
      ? { to: "/dashboard", label: "Studio", Icon: Radio }
      : { to: "/login?next=%2Ffollowing", label: "Sign in", Icon: LogIn },
  ];

  return (
    <div className="min-h-screen">
      <a
        className="sr-only focus:not-sr-only focus:bg-background focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:px-3 focus:py-2"
        href="#main-content"
      >
        Skip to content
      </a>

      <header className="bg-background/95 sticky top-0 z-40 border-b pt-(--safe-top) backdrop-blur">
        <div className="flex h-(--header-height) items-center gap-3 px-(--page-pad)">
          <Brand />

          <SearchForm className="mx-auto hidden max-w-lg tablet:block" />

          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="tablet:hidden"
              aria-label="Search"
              aria-expanded={searchOpen}
              onClick={() => setSearchOpen(!searchOpen)}
            >
              {searchOpen ? <X /> : <Search />}
            </Button>
            <Button
              asChild
              variant="ghost"
              className="laptop:inline-flex hidden"
            >
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
                  <span className="bg-primary absolute top-2.5 right-2.5 size-2 rounded-full" />
                )}
              </Button>
              {notificationsOpen && (
                <section
                  className="bg-popover fixed inset-x-(--page-pad) top-[calc(var(--safe-top)+var(--header-height)+var(--space-2))] z-50 flex max-h-[70vh] flex-col gap-3 overflow-y-auto rounded-xl border p-(--card-pad) shadow-lg tablet:absolute tablet:inset-x-auto tablet:top-auto tablet:right-0 tablet:mt-2 tablet:w-[380px]"
                  id="live-notifications"
                  aria-label="Notifications"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">Your live updates</h3>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Close notifications"
                      onClick={() => {
                        setNotificationsOpen(false);
                        notificationButton.current?.focus();
                      }}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                  <NotificationsPanel
                    close={() => setNotificationsOpen(false)}
                  />
                </section>
              )}
            </div>
            {me.data ? (
              <Link
                to="/dashboard"
                aria-label={`Creator studio for ${me.data.username}`}
                className="grid size-(--icon-button) place-items-center"
              >
                <Avatar className="size-8">
                  <AvatarFallback className="bg-[var(--mauve-surface)] text-[var(--mauve-muted)] text-xs">
                    {me.data.username.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </Link>
            ) : (
              <Button asChild className="hidden laptop:inline-flex">
                <Link to="/login?next=%2Ffollowing">Sign in</Link>
              </Button>
            )}
          </div>
        </div>
        {searchOpen && (
          <div className="px-(--page-pad) pb-3 tablet:hidden">
            <SearchForm autoFocus onDone={() => setSearchOpen(false)} />
          </div>
        )}
      </header>

      <div className="flex">
        <aside
          id="viewer-sidebar"
          className="bg-card sticky top-[calc(var(--safe-top)+var(--header-height))] hidden h-[calc(100vh-var(--header-height)-var(--safe-top))] w-(--sidebar-width) shrink-0 overflow-y-auto border-r laptop:block"
          aria-label="Main navigation"
        >
          <SidebarNav onNavigate={() => undefined} />
        </aside>

        <main className="min-w-0 flex-1" id="main-content">
          <div
            className={cn(
              "mx-auto flex w-full max-w-(--content-max) flex-col gap-(--section-gap) px-(--page-pad) pt-(--section-gap)",
              BOTTOM_NAV_CLEARANCE,
            )}
          >
            {children}
            <SiteFooter />
          </div>
        </main>
      </div>

      <BottomNav label="Main navigation" items={navItems} />
    </div>
  );
}
