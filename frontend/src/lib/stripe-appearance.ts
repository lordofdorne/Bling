import { useMemo } from "react";
import type { AppearanceOptions } from "@stripe/connect-js";
import type { Appearance } from "@stripe/stripe-js";
import { cssToken, type ResolvedTheme } from "./theme";
import { useTheme } from "./ThemeProvider";

// Stripe renders inside iframes that cannot see our stylesheet, so every
// value here is read from tokens.css at runtime. Nothing is copied.

const FONT_FAMILY =
  'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

// Stripe's rule objects take plain colors, not color-mix(). Tints are derived
// from the token's hex value instead.
function withAlpha(hex: string, alpha: number) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return hex;
  const value = parseInt(match[1], 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

function readPalette() {
  return {
    accent: cssToken("--accent"),
    onAccent: cssToken("--on-accent"),
    danger: cssToken("--accent-light"),
    success: cssToken("--green-light"),
    surface: cssToken("--surface"),
    surfaceRaised: cssToken("--surface-raised"),
    surfaceHover: cssToken("--surface-hover"),
    text: cssToken("--text"),
    muted: cssToken("--muted"),
    border: cssToken("--border"),
    borderStrong: cssToken("--border-strong"),
    overlay: cssToken("--overlay"),
    radius: cssToken("--control-radius"),
    controlFont: cssToken("--control-lg-font"),
    gapRow: cssToken("--space-4"),
    gapColumn: cssToken("--space-3"),
  };
}

// Payment Element (caller card holds and saved payment methods). Inputs sit on
// a Card, so they match shadcn's Input: transparent fill, strong border, accent
// focus ring.
export function stripeElementsAppearance(theme: ResolvedTheme): Appearance {
  const p = readPalette();
  const focusRing = `0 0 0 3px ${withAlpha(p.accent, 0.5)}`;
  return {
    theme: theme === "dark" ? "night" : "stripe",
    variables: {
      colorPrimary: p.accent,
      colorBackground: p.surface,
      colorText: p.text,
      colorTextSecondary: p.muted,
      colorTextPlaceholder: p.muted,
      colorDanger: p.danger,
      colorSuccess: p.success,
      fontFamily: FONT_FAMILY,
      borderRadius: p.radius,
      gridRowSpacing: p.gapRow,
      gridColumnSpacing: p.gapColumn,
    },
    rules: {
      ".Label": { color: p.text, fontWeight: "500" },
      ".Input": {
        backgroundColor: p.surface,
        border: `1px solid ${p.borderStrong}`,
        boxShadow: "none",
      },
      ".Input:focus": { borderColor: p.accent, boxShadow: focusRing },
      ".Input--invalid": { borderColor: p.danger, boxShadow: "none" },
      ".Tab": {
        backgroundColor: p.surface,
        border: `1px solid ${p.border}`,
        boxShadow: "none",
      },
      ".Tab:hover": { backgroundColor: p.surfaceHover, color: p.text },
      ".Tab--selected, .Tab--selected:hover": {
        backgroundColor: p.surfaceRaised,
        borderColor: p.accent,
        color: p.text,
        boxShadow: "none",
      },
      ".Tab:focus": { boxShadow: focusRing },
      ".Block": {
        backgroundColor: p.surfaceRaised,
        border: `1px solid ${p.border}`,
        boxShadow: "none",
      },
      ".PickerItem": {
        backgroundColor: p.surface,
        border: `1px solid ${p.border}`,
        boxShadow: "none",
      },
      ".PickerItem--selected": { borderColor: p.accent },
    },
  };
}

// Connect embedded onboarding (creator payout setup).
export function stripeConnectAppearance(): AppearanceOptions {
  const p = readPalette();
  return {
    overlays: "dialog",
    variables: {
      fontFamily: FONT_FAMILY,
      borderRadius: p.radius,
      colorPrimary: p.accent,
      colorBackground: p.surface,
      colorText: p.text,
      colorSecondaryText: p.muted,
      colorDanger: p.danger,
      colorBorder: p.borderStrong,
      offsetBackgroundColor: p.surfaceRaised,
      formBackgroundColor: p.surface,
      formHighlightColorBorder: p.accent,
      formAccentColor: p.accent,
      formPlaceholderTextColor: p.muted,
      actionPrimaryColorText: p.accent,
      actionSecondaryColorText: p.muted,
      buttonPrimaryColorBackground: p.accent,
      buttonPrimaryColorBorder: p.accent,
      buttonPrimaryColorText: p.onAccent,
      buttonSecondaryColorBackground: p.surfaceRaised,
      buttonSecondaryColorBorder: p.border,
      buttonSecondaryColorText: p.text,
      buttonBorderRadius: p.radius,
      formBorderRadius: p.radius,
      buttonLabelFontSize: p.controlFont,
      overlayBackdropColor: withAlpha(p.overlay, 0.7),
    },
  };
}

// Appearance for the active theme. Re-reads tokens whenever the theme flips so
// an open card form or onboarding flow repaints with the rest of the page.
export function useStripeAppearance() {
  const { resolved } = useTheme();
  return useMemo(
    () => ({
      theme: resolved,
      elements: stripeElementsAppearance(resolved),
      connect: stripeConnectAppearance(),
    }),
    [resolved],
  );
}
