/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "convex" switches every data hook to Convex (see src/lib/backend.ts). */
  readonly VITE_BACKEND?: string;
  readonly VITE_CONVEX_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
