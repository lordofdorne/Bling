import { type FormEvent, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { ApiError } from "../lib/api";
import { useLogin, useMe, useRegister } from "../lib/auth";

type AuthPageProps = { mode: "login" | "register" };

export function AuthPage({ mode }: AuthPageProps) {
  const navigate = useNavigate();
  const me = useMe();
  const login = useLogin();
  const register = useRegister();
  const activeMutation = mode === "login" ? login : register;
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  if (me.data) {
    return <Navigate to="/dashboard" replace />;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      if (mode === "register") {
        await register.mutateAsync({ username, email, password });
      } else {
        await login.mutateAsync({ email, password });
      }
      navigate("/dashboard", { replace: true });
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
      <Link className="brand" to="/">
        Bling<span>.</span>
      </Link>
      <section className="auth-card">
        <p className="eyebrow">Creator access</p>
        <h1>{mode === "login" ? "Welcome back." : "Open your Hotline."}</h1>
        <p className="auth-intro">
          {mode === "login"
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
            {mode === "register" && <small>Use at least 12 characters.</small>}
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
          <Link to={mode === "login" ? "/register" : "/login"}>
            {mode === "login" ? "Create an account" : "Sign in"}
          </Link>
        </p>
      </section>
    </main>
  );
}
