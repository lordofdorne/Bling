import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  ChevronLeft,
  Compass,
  LogOut,
  Radio,
  Settings,
  UserRound,
} from "lucide-react";
import { useLogout } from "../../lib/auth";
import { Brand } from "../ViewerShell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  BottomNav,
  BOTTOM_NAV_CLEARANCE,
  type BottomNavItem,
} from "../BottomNav";
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
  "text-muted-foreground px-3 pb-2 text-(length:--text-eyebrow) font-bold tracking-[0.12em] uppercase";

function StudioNav({ username }: { username: string }) {
  return (
    <nav className="flex flex-col gap-1">
      <p className={groupLabelClass}>Workspace</p>
      <Link to="/dashboard" className={linkClass(true)}>
        <Radio className="size-[18px]" />
        Studio
      </Link>
      <Link to="/dashboard/settings" className={linkClass()}>
        <Settings className="size-[18px]" />
        Settings
      </Link>
      <Separator className="my-4" />
      <p className={groupLabelClass}>Channel</p>
      <Link to={`/u/${username}`} className={linkClass()}>
        <UserRound className="size-[18px]" />
        View public page
        <ArrowRight className="ml-auto size-3.5" />
      </Link>
    </nav>
  );
}

function SettingsNav({ section }: { section: SettingsSection | null }) {
  return (
    <nav className="flex flex-col gap-1">
      <Link
        to="/dashboard"
        className="text-muted-foreground hover:text-foreground mb-2 flex items-center gap-2 px-3 py-2 text-sm font-semibold"
      >
        <ChevronLeft className="size-4" />
        Back to studio
      </Link>
      <Link to="/dashboard/settings" className={linkClass(section === null)}>
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
  const signOut = useSignOut();

  const navItems: BottomNavItem[] = [
    { to: "/dashboard", label: "Studio", Icon: Radio, end: true },
    { to: `/u/${username}`, label: "Channel", Icon: UserRound },
    { to: "/dashboard/settings", label: "Settings", Icon: Settings },
    { to: "/", label: "Discover", Icon: Compass, end: true },
  ];

  return (
    <div className="min-h-screen">
      <a
        className="sr-only focus:not-sr-only focus:bg-background focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:px-3 focus:py-2"
        href="#studio-main"
      >
        Skip to studio
      </a>

      <header className="bg-background/95 sticky top-0 z-40 border-b pt-(--safe-top) backdrop-blur">
        <div className="flex h-(--header-height) items-center gap-3 px-(--page-pad)">
          <Brand />
          <span className="text-muted-foreground border-l pl-3 text-(length:--text-eyebrow) font-bold tracking-[0.14em] uppercase">
            Studio
          </span>
          <Button
            asChild
            variant="ghost"
            className="laptop:inline-flex ml-auto hidden"
          >
            <Link to="/">
              Explore Bling <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </header>

      <div className="flex">
        <aside
          className="bg-card laptop:flex sticky top-[calc(var(--safe-top)+var(--header-height))] hidden h-[calc(100vh-var(--header-height)-var(--safe-top))] w-(--sidebar-width) shrink-0 flex-col justify-between gap-8 overflow-y-auto border-r p-4"
          aria-label={isSettings ? "Settings navigation" : "Creator navigation"}
        >
          {isSettings ? (
            <SettingsNav section={settingsSection} />
          ) : (
            <StudioNav username={username} />
          )}
          <Button
            variant="ghost"
            className="justify-start"
            type="button"
            onClick={() => void signOut.run()}
            disabled={signOut.isPending}
          >
            <LogOut className="size-4" />
            {signOut.isPending ? "Signing out…" : "Sign out"}
          </Button>
        </aside>

        <main id="studio-main" className="min-w-0 flex-1">
          <div
            className={cn(
              "mx-auto flex w-full max-w-(--content-max) flex-col gap-(--section-gap) px-(--page-pad) pt-(--section-gap)",
              BOTTOM_NAV_CLEARANCE,
            )}
          >
            {children}
            {signOut.isError && (
              <Alert variant="destructive">
                <AlertDescription>
                  Unable to sign out. Please try again.
                </AlertDescription>
              </Alert>
            )}
          </div>
        </main>
      </div>

      <BottomNav label="Studio navigation" items={navItems} />
    </div>
  );
}

// Sign out, shared by the sidebar (laptop+) and Account settings (phone).
// eslint-disable-next-line react-refresh/only-export-components
export function useSignOut() {
  const logout = useLogout();
  const navigate = useNavigate();
  return {
    isPending: logout.isPending,
    isError: logout.isError,
    async run() {
      try {
        await logout.mutateAsync();
        navigate("/login", { replace: true });
      } catch {
        // The inline status keeps the creator in a recoverable state.
      }
    },
  };
}
