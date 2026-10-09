import type { ComponentType } from "react";
import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";

export type BottomNavItem = {
  to: string;
  label: string;
  Icon: ComponentType<{ className?: string }>;
  /** Match the path exactly (for "/" style roots). */
  end?: boolean;
  /** Small dot for unseen activity. */
  badge?: boolean;
};

// Primary navigation on phones and tablets: a fixed tab bar in thumb reach,
// clear of the home indicator. Laptop and up use the sidebar instead.
// Keep it to 3–5 destinations; account actions such as sign out belong in
// settings, not here.
export function BottomNav({
  items,
  label,
}: {
  items: BottomNavItem[];
  label: string;
}) {
  return (
    <nav
      aria-label={label}
      className="bg-background/95 laptop:hidden fixed inset-x-0 bottom-0 z-40 border-t pb-(--safe-bottom) backdrop-blur"
    >
      <ul className="mx-auto flex h-(--bottom-nav-height) max-w-xl items-stretch">
        {items.map(({ to, label: itemLabel, Icon, end, badge }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "flex h-full flex-col items-center justify-center gap-1 text-(length:--text-eyebrow) font-semibold transition-colors",
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )
              }
            >
              <span className="relative">
                <Icon className="size-[22px]" />
                {badge && (
                  <span className="bg-primary absolute -top-0.5 -right-1 size-2 rounded-full" />
                )}
              </span>
              {itemLabel}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// Space reserved under page content so the fixed tab bar never covers it.
export const BOTTOM_NAV_CLEARANCE =
  "pb-[calc(var(--bottom-nav-height)+var(--safe-bottom)+var(--space-6))] laptop:pb-(--section-gap)";
