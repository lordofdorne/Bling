# Bling UI design system

The redesign covers viewer discovery, following, public creator profiles, the creator studio, authentication, and the existing public Hotline. It takes familiar streaming-platform navigation and content hierarchy and uses the supplied palette throughout.

## Brand colors

| Token      | Supplied color | Role                                                    |
| ---------- | -------------- | ------------------------------------------------------- |
| `--mauve`  | `#52414C`      | Featured areas, creator identity, illustration surfaces |
| `--ebony`  | `#596157`      | Neutral green surfaces and borders                      |
| `--green`  | `#5B8C5A`      | Live status and selected live filter                    |
| `--sand`   | `#CFD186`      | Selected categories, highlights, focus indicators       |
| `--accent` | `#E3655B`      | Primary actions and brand mark                          |

Dark neutral backgrounds and lighter text tints support legibility. Coral actions use dark text; small live badges use a darker coral for white-text contrast. Color is paired with status text or icons. The base font uses the existing system stack; no font dependency was added.

## Components and styling

The interface is built on [shadcn/ui](https://ui.shadcn.com) (new-york style) over Tailwind v4 and Radix primitives. The components live in `frontend/src/components/ui/` and are written in place rather than pulled with the shadcn CLI, whose registry this environment cannot reach; they are otherwise the upstream files and can be updated from upstream.

No component carries a hex value. `frontend/src/styles.css` is the Tailwind entry, and a single `@theme inline` block maps shadcn's semantic names onto the Bling tokens above — `--color-primary` to `--accent`, `--color-card` to `--surface`, `--color-muted-foreground` to `--muted`, and so on — so every component inherits the palette and both themes from `tokens.css`. That file plus the token bridge is the whole stylesheet; page layout is Tailwind utilities.

Shared navigation and brand components are in `ViewerShell.tsx`, the studio shell and its sections in `components/studio/`, and icons come from `lucide-react`. Layouts adapt to narrow phones, tablets, and wide desktop screens; the sidebars become a Sheet on small screens. Focus styles, labeled controls, skip links, and larger touch targets are included.

## Real application behavior

`/dashboard`, `/login`, `/register`, and `/u/:username` preserve the existing authentication, show creation/start/end, tier configuration, queue, Stripe, payout, and WebRTC hooks and handlers. Their business workflows are preserved; the social layer adds profiles, discovery, follows, and live notifications. Studio summary cards only show existing API state; they do not fabricate revenue or audience analytics.

The studio presents Hotline controls first in document order, with payout setup and payment activity alongside them on desktop and below them on mobile.

## Real social data

- `/` and `/browse` display published creators from PostgreSQL, with server-side search, category/live filters, keyset pagination, and live-first follower ranking.
- `/following` uses authenticated database relationships. Follow controls update optimistically and recover from errors; a fresh session loads the same server state.
- `/u/:username` is the real channel and caller route. Legacy `/discover/:username` links redirect here.
- Header notifications display durable live events and read state for currently followed creators. These are in-app updates, with a 30-day window.
- Creator studio includes profile editing: display name, bio, category, HTTPS avatar/cover URLs and publication. Images have initials fallbacks. New viewer accounts are unlisted until publishing or opening a show.
- Presence is labeled “on page,” counts recent channel-page visitors and expires after 90 seconds. It is not a broadcast audience or fabricated analytics.

Fixture data and local-storage follow state have been removed. Existing database accounts may have names left over from previous local testing; those are actual account rows, not new UI fixtures.

See [social architecture](social-architecture.md) for contracts, consistency, operational limits, and deployment instructions.

## Verification

Frontend regression tests cover authentication, Hotline lifecycle, queue, payment presentation, WebRTC, server-backed discovery/follows, rollback/retry, cursor paging, account isolation, notifications, and profile editing. The real HTTP integration test exercises registration through go-live and unread/read updates against PostgreSQL and Redis. The local preview was checked with actual database profiles and genuine following/notification empty states. No new Stripe transactions or two-party microphone calls were performed during this social integration.
