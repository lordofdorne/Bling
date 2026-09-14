import { fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider } from "./ThemeProvider";
import { resolveTheme, THEME_STORAGE_KEY } from "./theme";
import { ThemeSwitch } from "../components/ThemeSwitch";

function stubScheme(light: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: light && query.includes("prefers-color-scheme: light"),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
        onchange: null,
      }) as MediaQueryList,
  );
}

describe("theme", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.removeItem(THEME_STORAGE_KEY);
    document.documentElement.removeAttribute("data-theme");
  });

  it("resolves explicit and system preferences", () => {
    expect(resolveTheme("dark", true)).toBe("dark");
    expect(resolveTheme("light", false)).toBe("light");
    expect(resolveTheme("system", true)).toBe("light");
    expect(resolveTheme("system", false)).toBe("dark");
  });

  it("persists the settings switch onto the document", () => {
    stubScheme(false);
    render(
      <ThemeProvider>
        <ThemeSwitch />
      </ThemeProvider>,
    );

    expect(document.documentElement.dataset.theme).toBe("dark");
    fireEvent.click(screen.getByRole("radio", { name: /light/i }));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");

    fireEvent.click(screen.getByRole("radio", { name: /system/i }));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
