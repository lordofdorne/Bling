# AGENTS.md

Guidance for agents working in this repo.

## Design

The interface is [shadcn/ui](https://ui.shadcn.com) (new-york style) on Tailwind v4 and Radix, wearing the Bling design system. Components live in `frontend/src/components/ui/`; they are the upstream files, written in place because this environment cannot reach the shadcn registry, and can be re-synced with `npx shadcn add <component>` from a machine that can.

Build screens from those components — `Button`, `Input`, `Select`, `Card`, `Badge`, `Alert`, `Sheet`, `Tabs`, `Switch` — rather than new bespoke controls or `.button` class names. All UI must use Bling tokens. Do not introduce one-off hex, `rgb()`/`rgba()`, or magic padding/height values in components.

Color lives in `frontend/src/tokens.css`. Spacing and control sizes live there too. `frontend/src/styles.css` is the Tailwind entry, and its `@theme inline` block is the one place the two vocabularies meet: it maps shadcn's semantic names onto Bling tokens (`--color-primary` → `--accent`, `--color-card` → `--surface`, `--color-muted-foreground` → `--muted`, and the rest), so every component inherits the palette and both themes. Tailwind reads `--radius-*` and the 4px spacing scale straight from `tokens.css`, which means `rounded-md` and `p-4` are design-system values.

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

Buttons and inputs use three control sizes — do not invent a fourth. `Button`, `Input`, `Textarea` and `SelectTrigger` read these tokens directly, so `size="sm" | "default" | "lg"` is the whole API and a size change happens in `tokens.css`:

| Size   | Tokens           | Use                                                  |
| ------ | ---------------- | ---------------------------------------------------- |
| Small  | `--control-sm-*` | Compact icon follows, dense row actions, `size="sm"` |
| Medium | `--control-md-*` | Default buttons, inputs and selects                  |
| Large  | `--control-lg-*` | Auth submits, full-width mobile actions, `size="lg"` |

Touch targets on coarse pointers must be at least `--touch-min` (44px); a base rule in `styles.css` enforces this for buttons and select triggers. Icon-only controls use `--icon-button` (`size="icon"`).

Phone layout (≤720px): keep navigation scrollable instead of wrapping or clipping; do not leave actions like Sign out in the tab strip; stack studio overview cards to one column.

### Hooks

Read the system from hooks in `frontend/src/lib/design.ts`. Do not copy token values into components.

| Hook                | Returns                                                                              |
| ------------------- | ------------------------------------------------------------------------------------ |
| `useTheme()`        | `preference`, `resolved`, `setPreference`                                            |
| `useScreenSize()`   | `name`, `width`, `isPhone`/`isTablet`/`isLaptop`/`isDesktop`/`isWide`, `gridColumns` |
| `useDesignTokens()` | live CSS values for space, control sizes, and colors                                 |
| `useControlSize()`  | `"lg"` on phone, `"md"` otherwise — pass straight to `<Button size={…}>`             |

Breakpoints: phone ≤720, tablet ≤980, laptop ≤1180, desktop ≤1699, wide ≥1700. `data-screen` on `<html>` matches `useScreenSize().name`. The same boundaries exist as Tailwind variants — `tablet:`, `laptop:`, `desktop:`, `wide:` — so chrome written in utilities switches where the hooks say it should. Tailwind's own `sm:`/`md:`/`lg:` still exist; prefer the named ones for layout decisions.

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

`<Grid>` sets `display: grid` through a plain class, which a Tailwind `flex` utility on the same element would win against. Put the grid on its own wrapper rather than on a `Card`.
