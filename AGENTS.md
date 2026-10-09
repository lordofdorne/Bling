# AGENTS.md

Guidance for agents working in this repo.

## Tooling

Frontend formatting is [Biome](https://biomejs.dev) (`frontend/biome.json`), not Prettier; do not add Prettier or its config back. Run `npm run format` (or `make fmt`) to write and `npm run format:check` to verify. Biome only formats here: ESLint (`npm run lint`) stays the linter because it carries the React Hooks and React Compiler rules. Go uses `gofmt`.

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

### Mobile first

Most people use Bling on a phone. Design and build every screen at 375px wide first, then let it grow; check 375, 768 and 1280 before calling UI work done. Layout adapts by **viewport width** (phone ≤720, tablet ≤980); controls adapt by **input** (`pointer: coarse`). A phone gets both.

- **Navigation.** Below laptop width, primary navigation is the fixed `<BottomNav>` (`components/BottomNav.tsx`, 3–5 destinations) and the sidebar is hidden; there is no hamburger menu. Page content wraps in `BOTTOM_NAV_CLEARANCE` so the bar never covers it. Account actions such as Sign out live in Settings → Account, never in the tab bar. Search sits in the header (an icon on phones that opens a full-width field).
- **Safe areas.** The viewport uses `viewport-fit=cover`. Sticky headers pad by `--safe-top`, the tab bar by `--safe-bottom`.
- **Touch targets.** Every interactive element is at least `--touch-min` (44px) on touch. Buttons, inputs and selects get there through the control tokens; switches, radios and checkboxes keep their glyph size and get an invisible hit area from `styles.css` (matched by ARIA role, because `<FormControl>` replaces `data-slot`). Never fix a target with `min-height` on the control itself, which stretches it.
- **Inputs.** Field text is `--input-font`, 16px on touch, so iOS Safari never zooms on focus. Set `type`, `inputMode`, `autoComplete` and `enterKeyHint` so the right keyboard appears.
- **Actions.** On phones, a form's or card's actions go full width and stack (`w-full tablet:w-auto`, `flex-col tablet:flex-row`), with the primary action last, nearest the thumb. Use `useControlSize()` for the size.
- **Density.** No card inside a card. Lists of people or records are compact rows on phones (see `CreatorRow` in `DiscoverPage`), not one poster per screen. Tables become lists below tablet width. Balance or stat groups share one card.
- **No horizontal scroll.** Nothing may be wider than the viewport. Use `min-w-0` on flex children that hold text, `truncate` on single-line names, and flexible `basis-*` values instead of fixed `min-w-[…px]`.
- **Breakpoint variants.** Use the named variants (`tablet:`, `laptop:`, `desktop:`, `wide:` and their `max-*` forms) for layout. Do not use Tailwind's `sm:`/`md:`/`lg:` in screens; they don't match `useScreenSize()`.

### Spacing, type and sizes

Every size comes from `frontend/src/tokens.css`. Do not write pixel values (`p-10`, `text-[11px]`, `h-[72px]`, `min-w-[220px]`) in components; use a token, and add one first if none fits.

Spacing is the 4px scale, `--space-1` (4px) through `--space-9` (48px). Layout reads semantic tokens that tighten on phones:

| Token             | Laptop | Phone | Use                                               |
| ----------------- | ------ | ----- | ------------------------------------------------- |
| `--page-pad`      | 32px   | 16px  | Left/right page gutter                            |
| `--section-gap`   | 32px   | 24px  | Between page sections                             |
| `--stack-gap`     | 16px   | 12px  | Between items in a section (header → card, cards) |
| `--card-pad`      | 24px   | 16px  | Card padding (`Card` reads it)                    |
| `--card-gap`      | 20px   | 16px  | Between fields/blocks inside a card               |
| `--inset-pad`     | 16px   | 12px  | Inset panels and list rows inside a card          |
| `--header-height` | 64px   | 56px  | Sticky header                                     |

Type uses `--text-page-title` (30 → 24px on phones), `--text-section-title`, `--text-card-title`, `--text-body`, `--text-meta` and `--text-eyebrow`. Don't size headings by hand: use the components in `frontend/src/components/page.tsx`:

- `PageHeader`: one per page. Title, optional description, eyebrow, `back` link and `actions`.
- `SectionHeader`: section and card headings, with an optional trailing `action`.
- `Eyebrow`: the small uppercase label.

Buttons and inputs use three control sizes; do not invent a fourth. `Button`, `Input`, `Textarea` and `SelectTrigger` read these tokens directly, so `size="sm" | "default" | "lg"` is the whole API and a size change happens in `tokens.css`:

| Size   | Mouse | Touch | Use                                                        |
| ------ | ----- | ----- | ---------------------------------------------------------- |
| Small  | 32px  | 44px  | Dense row actions (`size="sm"`)                            |
| Medium | 40px  | 44px  | Default buttons, inputs and selects                        |
| Large  | 48px  | 48px  | Primary submits and full-width phone actions (`size="lg"`) |

Icon-only controls use `size="icon"` (`--icon-button`, 36px mouse / 44px touch). On touch, small and medium share a height, so controls side by side always line up; they differ only in padding and type.

### Hooks

Read the system from hooks in `frontend/src/lib/design.ts`. Do not copy token values into components.

| Hook                | Returns                                                                              |
| ------------------- | ------------------------------------------------------------------------------------ |
| `useTheme()`        | `preference`, `resolved`, `setPreference`                                            |
| `useScreenSize()`   | `name`, `width`, `isPhone`/`isTablet`/`isLaptop`/`isDesktop`/`isWide`, `gridColumns` |
| `useDesignTokens()` | live CSS values for space, control sizes, and colors                                 |
| `useControlSize()`  | `"lg"` on phone, `"md"` otherwise — pass straight to `<Button size={…}>`             |

Breakpoints: phone ≤720, tablet ≤980, laptop ≤1180, desktop ≤1699, wide ≥1700. `data-screen` on `<html>` matches `useScreenSize().name`. The same boundaries exist as Tailwind variants — `tablet:`, `laptop:`, `desktop:`, `wide:` — so chrome written in utilities switches where the hooks say it should. Tailwind's own `sm:`/`md:`/`lg:` still exist; prefer the named ones for layout decisions.

### Forms

Forms use react-hook-form with zod through shadcn's `Form` (`components/ui/form.tsx`). Do not hold field values in `useState` or validate by hand.

- Schemas live in `frontend/src/lib/schemas.ts`. Reuse the shared field rules (`emailField`, `newPasswordField`, `displayNameField`, …) so a value is checked the same way everywhere, and keep them in step with the API.
- Build fields from `frontend/src/components/form-fields.tsx` — `TextField`, `TextareaField`, `SelectField`, `SwitchField` — which wire label, help text and error message. Drop to `FormField`/`FormItem` only for custom layouts (masked inputs, radio cards). Show request failures with `<FormError error={mutation.error} />`.
- Lists of rows use `useFieldArray` (see `TierConfiguration`). Add `noValidate` to the `<form>` so zod, not the browser, reports errors.

Stripe Elements and Connect embeds take their appearance from `useStripeAppearance()` in `frontend/src/lib/stripe-appearance.ts`, which reads tokens at runtime and follows the theme.

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
