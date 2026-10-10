import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const apiTarget =
    loadEnv(mode, ".", "").VITE_API_PROXY_TARGET ?? "http://localhost:8080";
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    server: {
      port: 5173,
      proxy: {
        "/api": { target: apiTarget, ws: true },
        "/healthz": apiTarget,
        "/readyz": apiTarget,
      },
    },
    test: {
      globals: true,
      projects: [
        {
          extends: true,
          test: {
            name: "app",
            environment: "jsdom",
            include: ["src/**/*.test.{ts,tsx}"],
            setupFiles: "./src/test/setup.ts",
          },
        },
        {
          // Convex functions run against convex-test's in-memory backend in
          // the edge runtime, like the real Convex isolate.
          extends: true,
          test: {
            name: "convex",
            environment: "edge-runtime",
            include: ["convex/**/*.test.ts"],
            server: { deps: { inline: ["convex-test"] } },
          },
        },
      ],
    },
  };
});
