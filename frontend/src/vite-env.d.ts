/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "convex" switches every data hook to Convex (see src/lib/backend.ts). */
  readonly VITE_BACKEND?: string;
  readonly VITE_CONVEX_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  /** Meta Pixel, loaded in index.html; missing when an ad blocker stops it. */
  fbq?: (...args: unknown[]) => void;
}
