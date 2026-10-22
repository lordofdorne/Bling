import { Link } from "react-router-dom";
import { SITE } from "@/lib/site";
import { cn } from "@/lib/utils";

const LINKS = [
  { to: "/about", label: "About" },
  { to: "/pricing", label: "Pricing" },
  { to: "/faq", label: "FAQ" },
  { to: "/terms", label: "Terms" },
  { to: "/privacy", label: "Privacy" },
  { to: "/refunds", label: "Refunds" },
  { to: "/contact", label: "Contact" },
];

const SOCIAL_LABELS: Record<keyof typeof SITE.social, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  x: "X",
  youtube: "YouTube",
};

const SOCIAL = (
  Object.entries(SITE.social) as [keyof typeof SITE.social, string][]
)
  .filter(([, href]) => href)
  .map(([key, href]) => ({ href, label: SOCIAL_LABELS[key] }));

const linkClass =
  "hover:text-foreground inline-flex min-h-(--touch-min) items-center px-2 first:pl-0";

/**
 * About, pricing, policy and contact links, plus Bling's social accounts
 * once lib/site.ts lists them. Shown at the foot of public pages.
 */
export function SiteFooter({ className }: { className?: string }) {
  return (
    <footer
      className={cn(
        "text-muted-foreground flex flex-wrap items-center gap-x-1 gap-y-2 border-t pt-(--stack-gap) text-(length:--text-meta)",
        className,
      )}
    >
      <nav
        aria-label="About and policies"
        className="flex flex-wrap items-center"
      >
        {LINKS.map((link) => (
          <Link key={link.to} to={link.to} className={linkClass}>
            {link.label}
          </Link>
        ))}
      </nav>
      {SOCIAL.length > 0 && (
        <nav
          aria-label="Bling on social"
          className="flex flex-wrap items-center"
        >
          {SOCIAL.map((link) => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
            >
              {link.label}
            </a>
          ))}
        </nav>
      )}
      <span className="ml-auto">Bling © {new Date().getFullYear()}</span>
    </footer>
  );
}
