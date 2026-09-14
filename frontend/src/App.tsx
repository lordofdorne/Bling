import { Link, Route, Routes } from "react-router-dom";
import { AuthPage } from "./components/AuthPage";
import { Dashboard } from "./components/Dashboard";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { PublicHotline } from "./components/PublicHotline";
import { DiscoverPage, LegacyCreatorRedirect } from "./components/DiscoverPage";
import { ThemeProvider } from "./lib/ThemeProvider";

function NotFound() {
  return (
    <main className="page centered">
      <p className="eyebrow">404</p>
      <h1>This page is off the air.</h1>
      <Link className="text-link" to="/">
        Go home
      </Link>
    </main>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <Routes>
        <Route path="/" element={<DiscoverPage />} />
        <Route path="/following" element={<DiscoverPage view="following" />} />
        <Route path="/browse" element={<DiscoverPage view="browse" />} />
        <Route path="/discover/:username" element={<LegacyCreatorRedirect />} />
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
    </ThemeProvider>
  );
}
