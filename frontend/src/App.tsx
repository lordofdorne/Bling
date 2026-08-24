import { Link, Route, Routes, useParams } from "react-router-dom";
import { ApiStatus } from "./components/ApiStatus";

function Home() {
  return (
    <main className="page home">
      <nav className="nav">
        <Link className="brand" to="/">
          Bling<span>.</span>
        </Link>
        <Link className="button secondary" to="/dashboard">
          Creator dashboard
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

function Dashboard() {
  return (
    <main className="page centered">
      <p className="eyebrow">Creator workspace</p>
      <h1>Your Hotline starts here.</h1>
      <p className="lede">
        Creator accounts and show controls arrive in the next delivery slice.
      </p>
      <Link className="text-link" to="/">
        Back home
      </Link>
    </main>
  );
}

function PublicHotline() {
  const { username } = useParams();
  return (
    <main className="page centered">
      <p className="eyebrow">@{username}</p>
      <h1>Hotline is currently closed.</h1>
      <p className="lede">Come back when this creator is live.</p>
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
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/u/:username" element={<PublicHotline />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
