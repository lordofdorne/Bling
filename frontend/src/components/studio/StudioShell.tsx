import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  CreditCard,
  Home,
  LogOut,
  Menu,
  Radio,
  Settings,
  Sparkles,
  UserRound,
  Wallet,
} from "lucide-react";
import { useLogout } from "../../lib/auth";
import { Brand } from "../ViewerShell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export type SettingsSection = "profile" | "payments" | "payouts" | "account";

type NavItem = {
  to: string;
  label: string;
  Icon: typeof Home;
  active?: boolean;
  external?: boolean;
};

function StudioNav({
  username,
  isSettings,
  settingsSection,
  onNavigate,
  onSignOut,
  signingOut,
}: {
  username: string;
  isSettings: boolean;
  settingsSection: SettingsSection;
  onNavigate: () => void;
  onSignOut: () => void;
  signingOut: boolean;
}) {
  const workspace: NavItem[] = [
    { to: "/dashboard", label: "Overview", Icon: Home, active: !isSettings },
    {
      to: "/dashboard#hotline-controls",
      label: "Stream manager",
      Icon: Radio,
    },
    {
      to: "/dashboard#payment-activity",
      label: "Payment activity",
      Icon: Wallet,
    },
    {
      to: "/dashboard/settings/payouts",
      label: "Payout settings",
      Icon: Settings,
      active: isSettings && settingsSection === "payouts",
    },
    {
      to: "/dashboard/settings/payments",
      label: "Saved payments",
      Icon: CreditCard,
      active: isSettings && settingsSection === "payments",
    },
  ];
  const channel: NavItem[] = [
    {
      to: `/u/${username}`,
      label: "View public page",
      Icon: UserRound,
      external: true,
    },
    {
      to: "/dashboard/settings/profile",
      label: "Public profile",
      Icon: UserRound,
      active: isSettings && settingsSection === "profile",
    },
    {
      to: "/dashboard/settings/account",
      label: "Account details",
      Icon: Settings,
      active: isSettings && settingsSection === "account",
    },
  ];

  const renderItem = (item: NavItem) => (
    <Link
      key={item.label}
      to={item.to}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition-colors",
        item.active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <item.Icon className="size-[18px]" />
      {item.label}
      {item.external && <ArrowRight className="ml-auto size-3.5" />}
    </Link>
  );

  return (
    <div className="flex h-full flex-col justify-between gap-8 p-4">
      <nav className="flex flex-col gap-1">
        <p className="text-muted-foreground px-3 pb-2 text-[11px] font-bold tracking-[0.12em] uppercase">
          Your workspace
        </p>
        {workspace.map(renderItem)}
        <Separator className="my-4" />
        <p className="text-muted-foreground px-3 pb-2 text-[11px] font-bold tracking-[0.12em] uppercase">
          Your channel
        </p>
        {channel.map(renderItem)}
      </nav>

      <div className="flex flex-col gap-4">
        <div className="bg-muted rounded-xl p-4">
          <Sparkles className="text-[var(--sand-text)] size-5" />
          <strong className="mt-2 block text-sm leading-snug">
            A good show starts
            <br />
            with a conversation.
          </strong>
          <p className="text-muted-foreground mt-1 text-xs">
            Share your link. Open the line. Make someone’s day.
          </p>
        </div>
        <Button
          variant="ghost"
          className="justify-start"
          type="button"
          onClick={onSignOut}
          disabled={signingOut}
        >
          <LogOut className="size-4" />
          {signingOut ? "Signing out…" : "Sign out"}
        </Button>
      </div>
    </div>
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
  settingsSection: SettingsSection;
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
    <StudioNav
      username={username}
      isSettings={isSettings}
      settingsSection={settingsSection}
      onNavigate={() => setMenuOpen(false)}
      onSignOut={() => void signOut()}
      signingOut={logout.isPending}
    />
  );

  return (
    <div className="min-h-screen">
      <a
        className="sr-only focus:not-sr-only focus:bg-background focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:px-3 focus:py-2"
        href="#studio-main"
      >
        Skip to studio
      </a>

      <header className="bg-background/90 sticky top-0 z-40 flex h-[72px] items-center gap-3 border-b px-4 backdrop-blur md:px-6">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
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
          className="bg-card sticky top-[72px] hidden h-[calc(100vh-72px)] w-[260px] shrink-0 overflow-y-auto border-r lg:block"
          aria-label="Creator navigation"
        >
          {nav}
        </aside>

        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetContent side="left" className="w-[280px] overflow-y-auto p-0">
            <SheetTitle className="sr-only">Creator navigation</SheetTitle>
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
