import { Link } from "react-router-dom";
import { useMe } from "../../lib/auth";
import { ThemeSwitch } from "../ThemeSwitch";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export function AccountSettings({ username }: { username: string }) {
  const me = useMe();
  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Appearance" className="flex flex-col gap-4">
        <header>
          <h2 className="text-xl font-bold tracking-tight">Appearance</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Switch between dark, light, or your device setting.
          </p>
        </header>
        <ThemeSwitch />
      </section>

      <section aria-label="Account" className="flex flex-col gap-4">
        <header>
          <h2 className="text-xl font-bold tracking-tight">Account</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Your sign-in details and permanent channel address.
          </p>
        </header>
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
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6 py-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="m-0 text-right">{value}</dd>
    </div>
  );
}
