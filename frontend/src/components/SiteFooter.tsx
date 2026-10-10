import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

const LINKS = [
  { to: "/terms", label: "Terms" },
  { to: "/privacy", label: "Privacy" },
  { to: "/refunds", label: "Refunds" },
  { to: "/contact", label: "Contact" },
];

/** Policy and contact links, shown at the foot of public pages. */
export function SiteFooter({ className }: { className?: string }) {
  return (
    <footer
      className={cn(
        "text-muted-foreground flex flex-wrap items-center gap-x-1 gap-y-2 border-t pt-(--stack-gap) text-(length:--text-meta)",
        className,
      )}
    >
      <nav aria-label="Policies" className="flex flex-wrap items-center">
        {LINKS.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className="hover:text-foreground inline-flex min-h-(--touch-min) items-center px-2 first:pl-0"
          >
            {link.label}
          </Link>
        ))}
      </nav>
      <span className="ml-auto">Bling © {new Date().getFullYear()}</span>
    </footer>
  );
}
