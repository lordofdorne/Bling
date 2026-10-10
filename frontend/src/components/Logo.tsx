import { cn } from "@/lib/utils";

// The "bling." wordmark, drawn as shapes rather than set in a font so it looks
// the same on every device. The "b." app icon and favicon live in public/.

/** The "bling." wordmark. Letters follow the text color. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="640 292 872 336"
      className={cn("h-6 w-auto", className)}
      aria-hidden="true"
      focusable="false"
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="62"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M675.5 328V522" />
        <circle cx="742" cy="460" r="65" />
        <path d="M887.5 328V522" />
        <path d="M968.5 408V522" />
        <path d="M1050.5 408V522M1050.5 462A60 60 0 0 1 1170.5 462V522" />
        <circle cx="1312" cy="458" r="63" />
        <path d="M1379 405V532A62 62 0 0 1 1317 594H1300C1284 594 1271 590 1259 583" />
      </g>
      <circle cx="968.5" cy="329" r="32" fill="currentColor" />
      <circle cx="1468.5" cy="511" r="39" fill="var(--accent)" />
    </svg>
  );
}
