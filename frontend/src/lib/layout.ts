export const BREAKPOINTS = {
  phone: 720,
  tablet: 980,
  laptop: 1180,
  wide: 1700,
} as const;

export type ScreenName = "phone" | "tablet" | "laptop" | "desktop" | "wide";
export type GridSpan = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

export const GRID_COLUMNS: Record<ScreenName, GridSpan> = {
  phone: 4,
  tablet: 8,
  laptop: 12,
  desktop: 12,
  wide: 12,
};

export type SpanMap = {
  span?: number;
  phone?: number;
  tablet?: number;
  laptop?: number;
  desktop?: number;
  wide?: number;
};

export function screenFromWidth(width: number): ScreenName {
  if (width <= BREAKPOINTS.phone) return "phone";
  if (width <= BREAKPOINTS.tablet) return "tablet";
  if (width <= BREAKPOINTS.laptop) return "laptop";
  if (width <= BREAKPOINTS.wide - 1) return "desktop";
  return "wide";
}

export function gridColumnsFor(screen: ScreenName): GridSpan {
  return GRID_COLUMNS[screen];
}

export function spanForScreen(screen: ScreenName, spans: SpanMap): number {
  const columns = GRID_COLUMNS[screen];
  const requested =
    spans[screen] ??
    (screen === "laptop" ? spans.desktop : undefined) ??
    spans.span ??
    columns;
  return Math.min(Math.max(1, requested), columns);
}

export type DesignTokens = {
  space: Record<1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9, string>;
  pagePad: string;
  sectionGap: string;
  cardPad: string;
  headerHeight: string;
  control: {
    sm: { height: string; padX: string; font: string };
    md: { height: string; padX: string; font: string };
    lg: { height: string; padX: string; font: string };
  };
  touchMin: string;
  iconButton: string;
  colors: {
    bg: string;
    surface: string;
    text: string;
    muted: string;
    accent: string;
    sand: string;
    mauve: string;
    green: string;
  };
};

function readVar(name: `--${string}`): string {
  if (typeof document === "undefined") return "";
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

export function readDesignTokens(): DesignTokens {
  return {
    space: {
      1: readVar("--space-1"),
      2: readVar("--space-2"),
      3: readVar("--space-3"),
      4: readVar("--space-4"),
      5: readVar("--space-5"),
      6: readVar("--space-6"),
      7: readVar("--space-7"),
      8: readVar("--space-8"),
      9: readVar("--space-9"),
    },
    pagePad: readVar("--page-pad"),
    sectionGap: readVar("--section-gap"),
    cardPad: readVar("--card-pad"),
    headerHeight: readVar("--header-height"),
    control: {
      sm: {
        height: readVar("--control-sm-height"),
        padX: readVar("--control-sm-pad-x"),
        font: readVar("--control-sm-font"),
      },
      md: {
        height: readVar("--control-md-height"),
        padX: readVar("--control-md-pad-x"),
        font: readVar("--control-md-font"),
      },
      lg: {
        height: readVar("--control-lg-height"),
        padX: readVar("--control-lg-pad-x"),
        font: readVar("--control-lg-font"),
      },
    },
    touchMin: readVar("--touch-min"),
    iconButton: readVar("--icon-button"),
    colors: {
      bg: readVar("--bg"),
      surface: readVar("--surface"),
      text: readVar("--text"),
      muted: readVar("--muted"),
      accent: readVar("--accent"),
      sand: readVar("--sand"),
      mauve: readVar("--mauve"),
      green: readVar("--green"),
    },
  };
}

export function viewportWidth(): number {
  if (typeof window === "undefined") return BREAKPOINTS.laptop;
  const inner = window.innerWidth;
  const client = document.documentElement.clientWidth;
  if (client > 0) return Math.min(client, inner);
  return inner;
}
