import { type FormEvent, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, Phone, Sparkles } from "lucide-react";
import { ApiError } from "../lib/api";
import { useLogin, useMe, useRegister } from "../lib/auth";
import { Brand } from "./ViewerShell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
    <main className="min-h-screen">
      <header className="flex items-center justify-between px-6 py-5">
        <Brand />
        <Button asChild variant="link">
          <Link to="/">
            Back to discover <ArrowRight className="size-4" />
          </Link>
        </Button>
      </header>

      <div className="mx-auto grid w-full max-w-5xl gap-10 px-6 pb-16 lg:grid-cols-2 lg:items-center">
        <section className="hidden lg:block">
          <p className="text-[var(--sand-text)] text-xs font-bold tracking-[0.14em] uppercase">
            Closer to your community
          </p>
          <h2 className="mt-3 text-4xl leading-tight font-extrabold tracking-tight">
            A big stage.
            <br />A personal
            <br />
            <em className="text-primary not-italic">connection.</em>
          </h2>
          <p className="text-muted-foreground mt-4 text-sm">
            The best part of going live? The people on the other end.
          </p>
          <div
            className="relative mt-10 grid h-64 place-items-center rounded-2xl border border-[var(--mauve-border)] bg-[var(--mauve-surface)]"
            aria-hidden="true"
          >
            <span className="border-primary/30 absolute size-44 animate-pulse rounded-full border" />
            <span className="bg-background text-primary grid size-24 place-items-center rounded-full">
              <Phone className="size-10" />
            </span>
            <span className="text-[var(--sand-text)] absolute top-6 right-8">
              <Sparkles className="size-7" />
            </span>
            <span className="text-muted-foreground absolute bottom-5 flex items-center gap-2 text-xs">
              <span className="bg-primary size-2 rounded-full" />
              Good conversations start here.
            </span>
          </div>
          <p className="text-muted-foreground mt-6 text-xs">
            Your voice. Your space. Your Bling.
          </p>
        </section>

        <Card className="w-full">
          <CardContent className="flex flex-col gap-5">
            <div>
              <p className="text-[var(--sand-text)] text-xs font-bold tracking-[0.14em] uppercase">
                {viewerIntent ? "Your Bling account" : "Creator access"}
              </p>
              <h1 className="mt-2 text-2xl font-extrabold tracking-tight">
                {mode === "login"
                  ? "Welcome back."
                  : viewerIntent
                    ? "Find your people."
                    : "Open your Hotline."}
              </h1>
              <p className="text-muted-foreground mt-2 text-sm">
                {viewerIntent
                  ? "Follow creators, build your feed, and catch their next live conversation."
                  : mode === "login"
                    ? "Sign in to manage your live caller queue."
                    : "Create the account behind your public Bling URL."}
              </p>
            </div>

            <form className="flex flex-col gap-4" onSubmit={submit}>
              {mode === "register" && (
                <div className="grid gap-2">
                  <Label htmlFor="auth-username">Username</Label>
                  <Input
                    id="auth-username"
                    name="username"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    autoComplete="username"
                    minLength={3}
                    maxLength={30}
                    pattern="[a-z0-9_]+"
                    required
                  />
                  <p className="text-muted-foreground text-xs">
                    3–30 lowercase letters, numbers, or underscores.
                  </p>
                </div>
              )}
              <div className="grid gap-2">
                <Label htmlFor="auth-email">Email</Label>
                <Input
                  id="auth-email"
                  name="email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  maxLength={254}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="auth-password">Password</Label>
                <Input
                  id="auth-password"
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
                  <p className="text-muted-foreground text-xs">
                    Use at least 12 characters.
                  </p>
                )}
              </div>
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <Button
                type="submit"
                size="lg"
                disabled={activeMutation.isPending}
              >
                {activeMutation.isPending
                  ? "Please wait…"
                  : mode === "login"
                    ? "Sign in"
                    : "Create account"}
              </Button>
            </form>

            <p className="text-muted-foreground text-sm">
              {mode === "login" ? "New to Bling?" : "Already have an account?"}{" "}
              <Link
                className="text-foreground font-semibold underline underline-offset-4"
                to={`${mode === "login" ? "/register" : "/login"}?next=${encodeURIComponent(destination)}`}
              >
                {mode === "login" ? "Create an account" : "Sign in"}
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
