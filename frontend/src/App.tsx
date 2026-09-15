import { Link, Route, Routes } from "react-router-dom";
import { AuthPage } from "./components/AuthPage";
import { Dashboard } from "./components/Dashboard";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { PublicHotline } from "./components/PublicHotline";
import { DiscoverPage, LegacyCreatorRedirect } from "./components/DiscoverPage";
import { ScreenSizeProvider } from "./lib/ScreenSizeProvider";
import { ThemeProvider } from "./lib/ThemeProvider";
import { Button } from "@/components/ui/button";

function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center p-6 text-center">
      <div className="flex flex-col items-center gap-3">
        <p className="text-[var(--sand-text)] text-xs font-bold tracking-[0.14em] uppercase">
          404
        </p>
        <h1 className="text-2xl font-extrabold tracking-tight">
          This page is off the air.
        </h1>
        <Button asChild variant="secondary">
          <Link to="/">Go home</Link>
        </Button>
      </div>
    </main>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <ScreenSizeProvider>
        <Routes>
          <Route path="/" element={<DiscoverPage />} />
          <Route
            path="/following"
            element={<DiscoverPage view="following" />}
          />
          <Route path="/browse" element={<DiscoverPage view="browse" />} />
          <Route
            path="/discover/:username"
            element={<LegacyCreatorRedirect />}
          />
          <Route path="/login" element={<AuthPage mode="login" />} />
          <Route path="/register" element={<AuthPage mode="register" />} />
          <Route
            path="/dashboard/*"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route path="/u/:username" element={<PublicHotline />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </ScreenSizeProvider>
    </ThemeProvider>
  );
}
