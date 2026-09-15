import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { SETTINGS_GROUPS, settingsSectionsIn } from "./settings-sections";

export function SettingsDirectory() {
  return (
    <div className="flex flex-col gap-8">
      <header>
        <p className="text-[var(--sand-text)] text-xs font-bold tracking-[0.14em] uppercase">
          Creator studio
        </p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight">
          Settings
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Manage your channel, money, and account in one place.
        </p>
      </header>

      {SETTINGS_GROUPS.map((group) => (
        <section key={group} aria-labelledby={`settings-${group}`}>
          <h2
            id={`settings-${group}`}
            className="text-muted-foreground mb-3 text-[11px] font-bold tracking-[0.1em] uppercase"
          >
            {group}
          </h2>
          <Card className="gap-0 overflow-hidden py-0">
            {settingsSectionsIn(group).map((section, index) => (
              <Link
                key={section.id}
                to={`/dashboard/settings/${section.id}`}
                className={`hover:bg-accent/60 flex items-center gap-4 p-4 transition-colors ${
                  index > 0 ? "border-t" : ""
                }`}
              >
                <span className="bg-muted grid size-9 shrink-0 place-items-center rounded-lg text-[var(--sand-text)]">
                  <section.Icon className="size-[18px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block text-sm font-semibold">
                    {section.label}
                  </strong>
                  <small className="text-muted-foreground block text-xs">
                    {section.description}
                  </small>
                </span>
                <ChevronRight className="text-muted-foreground size-4 shrink-0" />
              </Link>
            ))}
          </Card>
        </section>
      ))}
    </div>
  );
}
