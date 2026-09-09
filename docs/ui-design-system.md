# Bling UI design system

The redesign covers viewer discovery, following, example creator profiles, the creator studio, authentication, and the existing public Hotline. It takes familiar streaming-platform navigation and content hierarchy and uses the supplied palette throughout.

## Brand colors

| Token      | Supplied color | Role                                                    |
| ---------- | -------------- | ------------------------------------------------------- |
| `--mauve`  | `#52414C`      | Featured areas, creator identity, illustration surfaces |
| `--ebony`  | `#596157`      | Neutral green surfaces and borders                      |
| `--green`  | `#5B8C5A`      | Live status and selected live filter                    |
| `--sand`   | `#CFD186`      | Selected categories, highlights, focus indicators       |
| `--accent` | `#E3655B`      | Primary actions and brand mark                          |

Dark neutral backgrounds and lighter text tints support legibility. Coral actions use dark text; small live badges use a darker coral for white-text contrast. Color is paired with status text or icons. The base font uses the existing system stack; no font dependency was added.

Styles live in `frontend/src/styles.css`. Shared navigation and brand components are in `ViewerShell.tsx`; icons are in `UiIcon.tsx`. Layouts adapt to narrow phones, tablets, and wide desktop screens, with scrollable category and studio navigation on small screens. Focus styles, labeled controls, skip links, reduced-motion support, and larger touch targets are included.

## Real application behavior

`/dashboard`, `/login`, `/register`, and `/u/:username` preserve the existing authentication, show creation/start/end, tier configuration, queue, Stripe, payout, and WebRTC hooks and handlers. Backend code and `frontend/src/lib/` are unchanged. Studio summary cards only show existing API state; they do not fabricate revenue or audience analytics.

The studio presents Hotline controls first in document order, with payout setup and payment activity alongside them on desktop and below them on mobile.

## Discovery preview boundary

The following are frontend previews, ready for future services:

- `/`: featured and popular example creators, search, categories, and a live-only filter.
- `/browse`: category discovery with the same filters.
- `/following`: locally followed creators, with live/offline presentation for fixtures.
- `/discover/:username`: example creator profiles, deliberately separate from real `/u/:username` queues.
- Header notifications: example live updates derived from locally followed fixtures, not push notifications.

`frontend/src/data/discovery.ts` contains all example names, topics, audience counts, live flags, and Unsplash portrait URLs. The current ordered fixture list puts popular live examples first. No video stream or real broadcast is implied by the image controls; cards link to profile previews.

`SocialPreview.tsx` and `ui/preview-follows.ts` manage device-local follow state under the distinct key `bling:design-preview:follows`. This state is separate from authentication and caller recovery storage. If browser storage is blocked or malformed, the preview remains usable. Following a real public channel adds a saved channel entry; its live status stays explicitly unknown rather than being fabricated.

Before connecting discovery to production:

1. Replace example creators with a discovery response, including stable identity, display name, avatar/cover, categories, live status, and audience counts.
2. Replace local follow state with authenticated follow/unfollow services. Keep button pending/error handling and connect the following feed to those identities.
3. Replace example notification data with the live-event subscription and notification preferences. The current panel does not request browser notification permission or send any notifications.
4. Route real discovery profiles to their actual public Hotline pages and remove the preview labels once data is real.
5. Replace example photography with creators' own media or approved product assets.

## Verification

The existing application regression tests cover auth, Hotline lifecycle, queues, payment presentation, and call/WebRTC behavior. Added discovery integration tests verify route persistence, follow/unfollow, combined filters, live-only filtering, malformed storage recovery, saved real channels, and the separation between example profiles and real queue endpoints.

Visual review used an isolated temporary fixture for studio offline/draft/live and public caller states. The fixture is not part of the final app. Real Stripe transactions and two-party microphone calls were not performed during this UI-only task.
