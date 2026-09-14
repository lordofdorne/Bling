import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  applyTheme,
  getThemePreference,
  prefersLightScheme,
  resolveTheme,
  setThemePreference,
  type ResolvedTheme,
  type ThemePreference,
} from "./theme";

type ThemeContextValue = {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    getThemePreference(),
  );
  const [systemIsLight, setSystemIsLight] = useState(() => prefersLightScheme());
  const resolved = useMemo(
    () => resolveTheme(preference, systemIsLight),
    [preference, systemIsLight],
  );

  useEffect(() => {
    applyTheme(preference);
    if (preference !== "system" || typeof window.matchMedia !== "function") {
      return;
    }
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => {
      setSystemIsLight(media.matches);
      applyTheme("system");
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    setThemePreference(next);
    setPreferenceState(next);
  }, []);

  const value = useMemo(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

// Theme context files export the hook beside the provider.
// eslint-disable-next-line react-refresh/only-export-components
export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return value;
}
