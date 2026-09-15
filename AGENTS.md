# AGENTS.md

Guidance for agents working in this repo.

## Design

All UI must use Bling tokens. Do not introduce one-off hex, `rgb()`/`rgba()`, or magic padding/height values in components.

Color lives in `frontend/src/tokens.css`. Spacing and control sizes live there too.

### Color

Brand primitives (shared across themes):

| Token      | Hex       | Role                                           |
| ---------- | --------- | ---------------------------------------------- |
| `--mauve`  | `#52414c` | Featured areas, identity, illustration         |
| `--ebony`  | `#596157` | Neutral olive surfaces and muted text on light |
| `--green`  | `#5b8c5a` | Live status                                    |
| `--sand`   | `#cfd186` | Highlights, selected fills                     |
| `--accent` | `#e3655b` | Primary actions and brand mark                 |

Semantic roles (`--bg`, `--surface`, `--text`, `--muted`, `--border`, `--on-accent`, `--sand-text`, and the rest) already exist for dark and light. If a screen needs a tint, mix from a token (`color-mix(in srgb, var(--accent) 10%, transparent)`). To change a color, edit the token. To add a color, add a token first.

Stripe and other embedded UI should read tokens at runtime (`cssToken(...)`), not copy hex.

### Spacing and sizes

Use the 4px scale: `--space-1` (4px) through `--space-9` (48px). Page chrome uses `--page-pad`, `--section-gap`, `--card-pad`, and `--header-height` (these shrink on viewports ≤720px).

Buttons and inputs use three control sizes — do not invent a fourth:

| Size   | Tokens           | Use                                                      |
| ------ | ---------------- | -------------------------------------------------------- |
| Small  | `--control-sm-*` | Compact icon follows, dense table actions, `.button-sm`  |
| Medium | `--control-md-*` | Default `.button` / `.primary-button` / `.follow-button` |
| Large  | `--control-lg-*` | Auth submits, full-width mobile actions, `.button-lg`    |

Touch targets on coarse pointers must be at least `--touch-min` (44px). Icon-only controls use `--icon-button`, bumping to `--touch-min` on mobile.

Phone layout (≤720px): keep navigation scrollable instead of wrapping or clipping; do not leave actions like Sign out in the tab strip; stack studio overview cards to one column.

### Hooks

Read the system from hooks in `frontend/src/lib/design.ts`. Do not copy token values into components.

| Hook                | Returns                                                                              |
| ------------------- | ------------------------------------------------------------------------------------ |
| `useTheme()`        | `preference`, `resolved`, `setPreference`                                            |
| `useScreenSize()`   | `name`, `width`, `isPhone`/`isTablet`/`isLaptop`/`isDesktop`/`isWide`, `gridColumns` |
| `useDesignTokens()` | live CSS values for space, control sizes, and colors                                 |
| `useControlSize()`  | `"lg"` on phone, `"md"` otherwise — map to `.button-lg` when needed                  |

Breakpoints: phone ≤720, tablet ≤980, laptop ≤1180, desktop ≤1699, wide ≥1700. `data-screen` on `<html>` matches `useScreenSize().name`.

### Adaptive grid

Use `<Grid>` and `<GridItem>` from `frontend/src/components/Grid.tsx` for content that should reflow. Chrome shells (sidebar + main) stay in CSS.

The grid is 12 columns on laptop+, 8 on tablet, 4 on phone. `span={4}` is one column on phone, half on tablet, a third on desktop, and with `wide={3}` a quarter on wide screens.

```tsx
<Grid>
  <GridItem span={4} wide={3}>
    card
  </GridItem>
  <GridItem span={8} tablet={8} phone={4}>
    main
  </GridItem>
  <GridItem span={4} tablet={8} phone={4}>
    side
  </GridItem>
</Grid>
```

Do not add per-breakpoint `grid-template-columns` for these layouts. Span props and `--grid-columns` do the adapting.
