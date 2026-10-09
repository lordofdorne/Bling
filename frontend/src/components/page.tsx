import type { ComponentProps, ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

// Page and section headings. Every screen uses these instead of hand-sized
// <h1>/<h2> markup, so the type scale (tokens.css --text-*) is the same
// everywhere and shrinks together on phones.

export function Eyebrow({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      className={cn(
        "text-[var(--sand-text)] text-(length:--text-eyebrow) font-bold tracking-[0.12em] uppercase",
        className,
      )}
      {...props}
    />
  );
}

export function PageHeader({
  title,
  description,
  eyebrow,
  back,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  /** A parent page to return to, shown above the title. */
  back?: { to: string; label: string };
  /** Page-level actions. They sit beside the title on wide screens and wrap
   * below it on phones. */
  actions?: ReactNode;
  /** Status or meta shown under the description. */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-col gap-3", className)}>
      {back && (
        <Link
          to={back.to}
          className="text-muted-foreground hover:text-foreground -ml-1 inline-flex min-h-(--control-sm-height) w-fit items-center gap-1 text-(length:--text-body) font-semibold"
        >
          <ChevronLeft className="size-4" />
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-col gap-2">
          {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
          <h1 className="text-(length:--text-page-title) leading-tight font-extrabold tracking-tight text-balance">
            {title}
          </h1>
          {description && (
            <p className="text-muted-foreground text-(length:--text-body) text-pretty">
              {description}
            </p>
          )}
          {children}
        </div>
        {actions && (
          <div className="flex w-full flex-wrap gap-2 tablet:w-auto">
            {actions}
          </div>
        )}
      </div>
    </header>
  );
}

export function SectionHeader({
  title,
  description,
  eyebrow,
  action,
  as: Heading = "h2",
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  /** A single trailing control or value (badge, link, figure). */
  action?: ReactNode;
  as?: "h2" | "h3";
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div className="flex min-w-0 flex-col gap-1">
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <Heading
          className={cn(
            "font-bold tracking-tight",
            Heading === "h2"
              ? "text-(length:--text-section-title)"
              : "text-(length:--text-card-title)",
          )}
        >
          {title}
        </Heading>
        {description && (
          <p className="text-muted-foreground text-(length:--text-body)">
            {description}
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
