import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * One line of the "Before you go live" card: an icon, a title with a one-line
 * status, and a small action. Details open beneath only while in use.
 */
export function SetupRow({
  icon: Icon,
  title,
  status,
  action,
  children,
  label,
}: {
  icon: LucideIcon;
  title: string;
  status: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  label: string;
}) {
  return (
    <section
      aria-label={label}
      className="flex flex-col gap-3 py-(--inset-pad) first:pt-0 last:pb-0"
    >
      <div className="flex items-center gap-3">
        <span className="bg-muted text-(--sand-text) grid size-9 shrink-0 place-items-center rounded-lg">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{title}</h3>
          <div className="text-muted-foreground text-(length:--text-meta)">
            {status}
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
