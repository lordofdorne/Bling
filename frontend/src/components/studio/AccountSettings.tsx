import { Link } from "react-router-dom";
import { LogOut } from "lucide-react";
import { useMe } from "../../lib/auth";
import { useControlSize } from "../../lib/design";
import { ThemeSwitch } from "../ThemeSwitch";
import { SectionHeader } from "../page";
import { useSignOut } from "./StudioShell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export function AccountSettings({ username }: { username: string }) {
  const me = useMe();
  const signOut = useSignOut();
  const controlSize = useControlSize();
  return (
    <div className="flex flex-col gap-(--section-gap)">
      <section
        aria-label="Appearance"
        className="flex flex-col gap-(--stack-gap)"
      >
        <SectionHeader
          title="Appearance"
          description="Switch between dark, light, or your device setting."
        />
        <ThemeSwitch />
      </section>

      <section aria-label="Account" className="flex flex-col gap-(--stack-gap)">
        <SectionHeader
          title="Account"
          description="Your sign-in details and permanent channel address."
        />
        <Card>
          <CardContent>
            <dl className="text-sm">
              <Row label="Username" value={`@${username}`} />
              <Separator />
              <Row label="Email address" value={me.data?.email ?? "—"} />
              <Separator />
              <Row
                label="Public channel"
                value={
                  <Link
                    className="font-semibold underline underline-offset-4"
                    to={`/u/${username}`}
                  >
                    /u/{username}
                  </Link>
                }
              />
            </dl>
          </CardContent>
        </Card>
        {/* On laptop and up, Sign out also lives at the foot of the sidebar.
            Phones and tablets reach it here, never from the tab bar. */}
        <Button
          variant="outline"
          size={controlSize}
          type="button"
          className="w-full tablet:w-fit"
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
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6 py-4 first:pt-0 last:pb-0">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="m-0 min-w-0 truncate text-right">{value}</dd>
    </div>
  );
}
