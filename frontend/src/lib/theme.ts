export const THEME_STORAGE_KEY = "bling-theme";

export type ThemePreference = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";

const THEME_PREFERENCES: ThemePreference[] = ["dark", "light", "system"];

export function cssToken(name: `--${string}`): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

export function syncDocumentThemeColor() {
  const bg = cssToken("--bg");
  if (!bg) {
    return;
  }
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", bg);
}

export function isThemePreference(
  value: string | null,
): value is ThemePreference {
  return THEME_PREFERENCES.includes(value as ThemePreference);
}

export function getThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemePreference(stored)) {
      return stored;
    }
  } catch {
    // Private mode and blocked storage fall back to dark.
  }
  return "dark";
}

export function prefersLightScheme(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: light)").matches
  );
}

export function resolveTheme(
  preference: ThemePreference,
  systemIsLight = prefersLightScheme(),
): ResolvedTheme {
  if (preference === "light") {
    return "light";
  }
  if (preference === "system") {
    return systemIsLight ? "light" : "dark";
  }
  return "dark";
}

export function applyTheme(preference: ThemePreference) {
  const resolved = resolveTheme(preference);
  document.documentElement.dataset.theme = resolved;
  syncDocumentThemeColor();
  return resolved;
}

export function setThemePreference(preference: ThemePreference) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Theme still applies for this session if storage is unavailable.
  }
  return applyTheme(preference);
}
