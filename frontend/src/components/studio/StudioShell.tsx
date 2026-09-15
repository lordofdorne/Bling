import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  ChevronLeft,
  LogOut,
  Menu,
  Radio,
  Settings,
  Sparkles,
  UserRound,
} from "lucide-react";
import { useLogout } from "../../lib/auth";
import { Brand } from "../ViewerShell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  SETTINGS_GROUPS,
  settingsSectionsIn,
  type SettingsSection,
} from "./settings-sections";
import { cn } from "@/lib/utils";

export type { SettingsSection };

const linkClass = (active?: boolean) =>
  cn(
    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition-colors",
    active
      ? "bg-primary/10 text-primary"
      : "text-muted-foreground hover:bg-accent hover:text-foreground",
  );

const groupLabelClass =
  "text-muted-foreground px-3 pb-2 text-[11px] font-bold tracking-[0.12em] uppercase";

function StudioNav({
  username,
  onNavigate,
}: {
  username: string;
  onNavigate: () => void;
}) {
  return (
    <nav className="flex flex-col gap-1">
      <p className={groupLabelClass}>Workspace</p>
      <Link to="/dashboard" onClick={onNavigate} className={linkClass(true)}>
        <Radio className="size-[18px]" />
        Studio
      </Link>
      <Link
        to="/dashboard/settings"
        onClick={onNavigate}
        className={linkClass()}
      >
        <Settings className="size-[18px]" />
        Settings
      </Link>
      <Separator className="my-4" />
      <p className={groupLabelClass}>Channel</p>
      <Link to={`/u/${username}`} onClick={onNavigate} className={linkClass()}>
        <UserRound className="size-[18px]" />
        View public page
        <ArrowRight className="ml-auto size-3.5" />
      </Link>
    </nav>
  );
}

function SettingsNav({
  section,
  onNavigate,
}: {
  section: SettingsSection | null;
  onNavigate: () => void;
}) {
  return (
    <nav className="flex flex-col gap-1">
      <Link
        to="/dashboard"
        onClick={onNavigate}
        className="text-muted-foreground hover:text-foreground mb-2 flex items-center gap-2 px-3 py-2 text-sm font-semibold"
      >
        <ChevronLeft className="size-4" />
        Back to studio
      </Link>
      <Link
        to="/dashboard/settings"
        onClick={onNavigate}
        className={linkClass(section === null)}
      >
        <Settings className="size-[18px]" />
        Settings
      </Link>
      {SETTINGS_GROUPS.map((group) => (
        <div key={group} className="mt-5 flex flex-col gap-1">
          <p className={groupLabelClass}>{group}</p>
          {settingsSectionsIn(group).map((item) => (
            <Link
              key={item.id}
              to={`/dashboard/settings/${item.id}`}
              onClick={onNavigate}
              className={linkClass(section === item.id)}
            >
              <item.Icon className="size-[18px]" />
              {item.label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}

export function StudioShell({
  username,
  isSettings,
  settingsSection,
  children,
}: {
  username: string;
  isSettings: boolean;
  settingsSection: SettingsSection | null;
  children: ReactNode;
}) {
  const logout = useLogout();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  async function signOut() {
    try {
      await logout.mutateAsync();
      navigate("/login", { replace: true });
    } catch {
      // The inline status below keeps the creator in a recoverable state.
    }
  }

  const nav = (
    <div className="flex h-full flex-col justify-between gap-8 p-4">
      {isSettings ? (
        <SettingsNav
          section={settingsSection}
          onNavigate={() => setMenuOpen(false)}
        />
      ) : (
        <StudioNav username={username} onNavigate={() => setMenuOpen(false)} />
      )}
      <div className="flex flex-col gap-4">
        {!isSettings && (
          <div className="bg-muted rounded-xl p-4">
            <Sparkles className="text-[var(--sand-text)] size-5" />
            <strong className="mt-2 block text-sm leading-snug">
              Your channel is built one conversation at a time.
            </strong>
            <p className="text-muted-foreground mt-1 text-xs">
              Share your link, open the line, and make someone’s day.
            </p>
          </div>
        )}
        <Button
          variant="ghost"
          className="justify-start"
          type="button"
          onClick={() => void signOut()}
          disabled={logout.isPending}
        >
          <LogOut className="size-4" />
          {logout.isPending ? "Signing out…" : "Sign out"}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen">
      <a
        className="sr-only focus:not-sr-only focus:bg-background focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:px-3 focus:py-2"
        href="#studio-main"
      >
        Skip to studio
      </a>

      <header className="bg-background/90 sticky top-0 z-40 flex h-[var(--header-height)] items-center gap-3 border-b px-4 backdrop-blur md:px-6">
        <Button
          variant="ghost"
          size="icon"
          className="laptop:hidden"
          aria-label="Toggle studio navigation"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <Menu />
        </Button>
        <Brand />
        <span className="text-muted-foreground hidden border-l pl-3 text-[11px] font-bold tracking-[0.14em] uppercase sm:inline">
          Creator studio
        </span>
        <div className="ml-auto flex items-center gap-3">
          <Button asChild variant="link">
            <Link to="/">
              Explore Bling <ArrowRight className="size-4" />
            </Link>
          </Button>
          <Avatar>
            <AvatarFallback className="bg-[var(--mauve-surface)] text-[var(--mauve-muted)]">
              {username.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        </div>
      </header>

      <div className="flex">
        <aside
          className="bg-card laptop:block sticky top-[var(--header-height)] hidden h-[calc(100vh-var(--header-height))] w-[260px] shrink-0 overflow-y-auto border-r"
          aria-label={isSettings ? "Settings navigation" : "Creator navigation"}
        >
          {nav}
        </aside>

        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetContent side="left" className="w-[280px] overflow-y-auto p-0">
            <SheetTitle className="sr-only">
              {isSettings ? "Settings navigation" : "Creator navigation"}
            </SheetTitle>
            {nav}
          </SheetContent>
        </Sheet>

        <main id="studio-main" className="min-w-0 flex-1">
          <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-10">
            {children}
            {logout.isError && (
              <Alert variant="destructive" className="mt-6">
                <AlertDescription>
                  Unable to sign out. Please try again.
                </AlertDescription>
              </Alert>
            )}
            <footer className="text-muted-foreground mt-12 flex flex-wrap items-center justify-between gap-2 border-t pt-6 text-xs">
              <span>Your voice. Your community.</span>
              <Link to="/" className="inline-flex items-center gap-1">
                Back to Bling <ArrowRight className="size-3.5" />
              </Link>
            </footer>
          </div>
        </main>
      </div>
    </div>
  );
}
