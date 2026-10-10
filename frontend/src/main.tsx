import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { BackendProvider } from "./lib/BackendProvider";
import { convexQueryClient } from "./lib/backend";
import { applyTheme, getThemePreference } from "./lib/theme";
import "./styles.css";

applyTheme(getThemePreference());

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      // With Convex, query keys made by convexQuery() become live
      // subscriptions; every other key behaves as before.
      ...(convexQueryClient && {
        queryKeyHashFn: convexQueryClient.hashFn(),
        queryFn: convexQueryClient.queryFn(),
      }),
    },
  },
});
convexQueryClient?.connect(queryClient);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BackendProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </BackendProvider>
  </StrictMode>,
);
