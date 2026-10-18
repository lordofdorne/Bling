import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Check, Copy, ExternalLink, LogOut } from "lucide-react";
import { useEmailPreferences, useSetLiveAlerts } from "../../lib/alerts";
import { useMe } from "../../lib/auth";
import { useControlSize } from "../../lib/design";
import { SITE } from "../../lib/site";
import { ThemeSwitch } from "../ThemeSwitch";
import { SectionHeader } from "../page";
import { useSignOut } from "./StudioShell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

// Account settings in the usual shape: one card per topic, each row a
// setting with its value and, where there is one, its action on the right.
// Destructive things sit last.

export function AccountSettings({ username }: { username: string }) {
  const me = useMe();
  const email = me.data?.email ?? "";
  const channelPath = `/u/${username}`;

  return (
    <div className="flex flex-col gap-(--stack-gap)">
      <Card aria-label="Account">
        <CardContent className="flex flex-col gap-(--card-gap)">
          <SectionHeader
            title="Account"
            description="How you sign in and where fans find you."
          />
          <dl className="divide-y border-y">
            <SettingRow
              label="Username"
              hint="Your username is permanent."
              value={`@${username}`}
            />
            <SettingRow label="Email" value={email || "—"} />
            <SettingRow
              label="Public channel"
              value={channelPath}
              action={<ChannelActions path={channelPath} />}
            />
          </dl>
        </CardContent>
      </Card>

      <Card aria-label="Security">
        <CardContent className="flex flex-col gap-(--card-gap)">
          <SectionHeader
            title="Security"
            description="Changing your password signs you out everywhere else."
          />
          <dl className="divide-y border-y">
            <SettingRow
              label="Password"
              value="••••••••••••"
              action={
                <Button asChild variant="secondary" size="sm">
                  <Link to="/forgot-password" state={{ email }}>
                    Change
                  </Link>
                </Button>
              }
            />
          </dl>
        </CardContent>
      </Card>

      <NotificationsCard />

      <Card aria-label="Appearance">
        <CardContent className="flex flex-col gap-(--card-gap)">
          <SectionHeader
            title="Appearance"
            description="Dark, light, or match your device."
          />
          <ThemeSwitch />
        </CardContent>
      </Card>

      <SessionCard />

      <Card aria-label="Delete account">
        <CardContent className="flex flex-col gap-(--card-gap) tablet:flex-row tablet:items-center tablet:justify-between">
          <SectionHeader
            title="Delete account"
            description="Close your account and delete your profile and data. Payment records are kept as the law requires."
          />
          <Button
            asChild
            variant="outline"
            className="border-destructive text-destructive hover:bg-destructive/10 w-full tablet:w-auto"
          >
            <a
              href={`mailto:${SITE.supportEmail}?subject=${encodeURIComponent(
                "Delete my Bling account",
              )}`}
            >
              Contact support
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

/** Email alerts; hidden when this account has no email to send to. */
function NotificationsCard() {
  const preferences = useEmailPreferences();
  const setLiveAlerts = useSetLiveAlerts();
  if (!preferences.data) return null;
  const enabled = setLiveAlerts.isPending
    ? setLiveAlerts.variables
    : preferences.data.liveAlerts;

  return (
    <Card aria-label="Notifications">
      <CardContent className="flex flex-col gap-(--card-gap)">
        <SectionHeader
          title="Notifications"
          description={`Emails go to ${preferences.data.email}.`}
        />
        <dl className="divide-y border-y">
          <SettingRow
            label="Creators going live"
            value="Email me when a creator I follow opens their Hotline."
            action={
              <Switch
                checked={enabled}
                onCheckedChange={(checked) => setLiveAlerts.mutate(checked)}
                aria-label="Email me when creators I follow go live"
              />
            }
          />
        </dl>
        {setLiveAlerts.isError && (
          <Alert variant="destructive">
            <AlertDescription>
              Couldn't save that. Please try again.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

function SettingRow({
  label,
  value,
  hint,
  action,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-(--touch-min) items-center gap-4 py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1 tablet:flex-row tablet:items-baseline tablet:gap-6">
        <dt className="text-muted-foreground shrink-0 text-(length:--text-meta) tablet:w-36 tablet:text-(length:--text-body)">
          {label}
        </dt>
        <dd className="m-0 min-w-0">
          <span className="block truncate font-medium">{value}</span>
          {hint && (
            <span className="text-muted-foreground block text-(length:--text-meta)">
              {hint}
            </span>
          )}
        </dd>
      </div>
      {action && <div className="flex shrink-0 gap-2">{action}</div>}
    </div>
  );
}

function ChannelActions({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${path}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused; the link is still visible to copy.
    }
  }

  return (
    <>
      <Button
        variant="secondary"
        size="icon"
        type="button"
        onClick={() => void copy()}
        aria-label={copied ? "Link copied" : "Copy channel link"}
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </Button>
      <Button asChild variant="secondary" size="icon">
        <Link to={path} aria-label="Open your channel">
          <ExternalLink className="size-4" />
        </Link>
      </Button>
    </>
  );
}

/**
 * On laptop and up, Sign out also lives at the foot of the sidebar. Phones
 * and tablets reach it here, never from the tab bar.
 */
function SessionCard() {
  const signOut = useSignOut();
  const controlSize = useControlSize();

  return (
    <Card aria-label="Session">
      <CardContent className="flex flex-col gap-(--card-gap) tablet:flex-row tablet:items-center tablet:justify-between">
        <SectionHeader
          title="Sign out"
          description="Sign out of Bling on this device."
        />
        <Button
          variant="secondary"
          size={controlSize}
          type="button"
          className="w-full tablet:w-auto"
          onClick={() => void signOut.run()}
          disabled={signOut.isPending}
        >
          <LogOut className="size-4" />
          {signOut.isPending ? "Signing out…" : "Sign out"}
        </Button>
        {signOut.isError && (
          <Alert variant="destructive">
            <AlertDescription>
              Unable to sign out. Please try again.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
