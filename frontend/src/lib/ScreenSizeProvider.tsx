import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import {
  BREAKPOINTS,
  gridColumnsFor,
  screenFromWidth,
  viewportWidth,
  type GridSpan,
  type ScreenName,
} from "./layout";

export type ScreenSize = {
  width: number;
  name: ScreenName;
  isPhone: boolean;
  isTablet: boolean;
  isLaptop: boolean;
  isDesktop: boolean;
  isWide: boolean;
  gridColumns: GridSpan;
};

function readScreenSize(width = viewportWidth()): ScreenSize {
  const name = screenFromWidth(width);
  return {
    width,
    name,
    isPhone: name === "phone",
    isTablet: name === "tablet",
    isLaptop: name === "laptop",
    isDesktop: name === "desktop",
    isWide: name === "wide",
    gridColumns: gridColumnsFor(name),
  };
}

const SERVER_SNAPSHOT = readScreenSize(BREAKPOINTS.laptop);
let snapshot = SERVER_SNAPSHOT;
const listeners = new Set<() => void>();
let attached = false;

function emit() {
  const next = readScreenSize();
  if (next.width === snapshot.width && next.name === snapshot.name) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

function ensureListening() {
  if (attached || typeof window === "undefined") return;
  attached = true;
  snapshot = readScreenSize();
  window.addEventListener("resize", emit);
  window.visualViewport?.addEventListener("resize", emit);
  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(emit);
    observer.observe(document.documentElement);
  }
  if (typeof window.matchMedia !== "function") return;
  const queries = [
    `(max-width: ${BREAKPOINTS.phone}px)`,
    `(max-width: ${BREAKPOINTS.tablet}px)`,
    `(max-width: ${BREAKPOINTS.laptop}px)`,
    `(min-width: ${BREAKPOINTS.wide}px)`,
  ];
  for (const query of queries) {
    const media = window.matchMedia(query);
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", emit);
    }
  }
}

function subscribe(listener: () => void) {
  ensureListening();
  listeners.add(listener);
  emit();
  return () => listeners.delete(listener);
}

export function ScreenSizeProvider({ children }: { children: ReactNode }) {
  const size = useScreenSize();

  useEffect(() => {
    document.documentElement.dataset.screen = size.name;
  }, [size.name]);

  return children;
}

// Screen context files export the hook beside the provider.
// eslint-disable-next-line react-refresh/only-export-components
export function useScreenSize(): ScreenSize {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => SERVER_SNAPSHOT,
  );
}
