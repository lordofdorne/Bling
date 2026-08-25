import { Link, Route, Routes } from "react-router-dom";
import { ApiStatus } from "./components/ApiStatus";
import { AuthPage } from "./components/AuthPage";
import { Dashboard } from "./components/Dashboard";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { PublicHotline } from "./components/PublicHotline";

function Home() {
  return (
    <main className="page home">
      <nav className="nav">
        <Link className="brand" to="/">
          Bling<span>.</span>
        </Link>
        <Link className="button secondary" to="/login">
          Creator sign in
        </Link>
      </nav>
      <section className="hero">
        <p className="eyebrow">The internet-native call-in show</p>
        <h1>Bring your audience into the conversation.</h1>
        <p className="lede">
          Run a live caller queue and speak one-on-one with viewers through
          direct, private audio.
        </p>
        <ApiStatus />
      </section>
    </main>
  );
}

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
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/register" element={<AuthPage mode="register" />} />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      />
      <Route path="/u/:username" element={<PublicHotline />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
