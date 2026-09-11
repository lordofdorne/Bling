import { type FormEvent, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError } from "../lib/api";
import { useLogin, useMe, useRegister } from "../lib/auth";

import { Brand } from "./ViewerShell";
import { UiIcon } from "./UiIcon";

type AuthPageProps = { mode: "login" | "register" };

export function AuthPage({ mode }: AuthPageProps) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const requested = params.get("next") ?? "/dashboard";
  // Restrict continuation to known local app paths, never external URLs.
  const destination =
    /^\/(?:following|browse|dashboard|u\/[a-z0-9_]{3,30})?(?:\?[^\\]*)?$/.test(
      requested,
    )
      ? requested
      : "/dashboard";
  const viewerIntent = destination !== "/dashboard";
  const me = useMe();
  const login = useLogin();
  const register = useRegister();
  const activeMutation = mode === "login" ? login : register;
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  if (me.data) {
    return <Navigate to={destination} replace />;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      if (mode === "register") {
        await register.mutateAsync({ username, email, password });
      } else {
        await login.mutateAsync({ email, password });
      }
      navigate(destination, { replace: true });
    } catch {
      // Mutation state renders the server's safe error message.
    }
  }

  const error =
    activeMutation.error instanceof ApiError
      ? activeMutation.error.message
      : activeMutation.error
        ? "Unable to connect. Please try again."
        : null;

  return (
    <main className="page auth-page">
      <header className="auth-header">
        <Brand />
        <Link className="text-button" to="/">
          Back to discover <UiIcon name="arrow" size={16} />
        </Link>
      </header>
      <div className="auth-layout">
        <section className="auth-story">
          <p className="eyebrow">Closer to your community</p>
          <h2>
            A big stage.
            <br />A personal
            <br />
            <em>connection.</em>
          </h2>
          <p>The best part of going live? The people on the other end.</p>
          <div className="auth-art" aria-hidden="true">
            <span className="auth-orbit" />
            <span className="auth-art-call">
              <UiIcon name="call" size={52} />
            </span>
            <span className="auth-art-spark">
              <UiIcon name="spark" size={30} />
            </span>
            <span className="auth-art-label">
              <span className="live-dot" />
              Good conversations start here.
            </span>
          </div>
          <span className="auth-story-footer">
            Your voice. Your space. Your Bling.
          </span>
        </section>
        <section className="auth-card">
          <p className="eyebrow">
            {viewerIntent ? "Your Bling account" : "Creator access"}
          </p>
          <h1>
            {mode === "login"
              ? "Welcome back."
              : viewerIntent
                ? "Find your people."
                : "Open your Hotline."}
          </h1>
          <p className="auth-intro">
            {viewerIntent
              ? "Follow creators, build your feed, and catch their next live conversation."
              : mode === "login"
                ? "Sign in to manage your live caller queue."
                : "Create the account behind your public Bling URL."}
          </p>
          <form className="auth-form" onSubmit={submit}>
            {mode === "register" && (
              <label>
                Username
                <input
                  name="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  minLength={3}
                  maxLength={30}
                  pattern="[a-z0-9_]+"
                  required
                />
                <small>3–30 lowercase letters, numbers, or underscores.</small>
              </label>
            )}
            <label>
              Email
              <input
                name="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                maxLength={254}
                required
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                minLength={mode === "register" ? 12 : undefined}
                maxLength={72}
                required
              />
              {mode === "register" && (
                <small>Use at least 12 characters.</small>
              )}
            </label>
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            <button
              className="primary-button"
              type="submit"
              disabled={activeMutation.isPending}
            >
              {activeMutation.isPending
                ? "Please wait…"
                : mode === "login"
                  ? "Sign in"
                  : "Create account"}
            </button>
          </form>
          <p className="auth-switch">
            {mode === "login" ? "New to Bling?" : "Already have an account?"}{" "}
            <Link
              to={`${mode === "login" ? "/register" : "/login"}?next=${encodeURIComponent(destination)}`}
            >
              {mode === "login" ? "Create an account" : "Sign in"}
            </Link>
          </p>
        </section>
      </div>
    </main>
  );
}
