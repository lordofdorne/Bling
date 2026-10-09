import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, Phone, Sparkles } from "lucide-react";
import { useLogin, useMe, useRegister } from "../lib/auth";
import {
  loginSchema,
  registerSchema,
  type LoginValues,
  type RegisterValues,
} from "../lib/schemas";
import { Brand } from "./ViewerShell";
import { FormError, TextField } from "./form-fields";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Form } from "@/components/ui/form";

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
  const [confirmationEmail, setConfirmationEmail] = useState("");

  if (me.data) {
    return <Navigate to={destination} replace />;
  }

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

      <div className="mx-auto grid w-full max-w-5xl gap-10 px-6 pb-16 lg:min-h-[calc(100vh-160px)] lg:grid-cols-2 lg:items-center">
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

            {confirmationEmail ? (
              <Alert>
                <AlertDescription>
                  Check {confirmationEmail} for a confirmation link. You can
                  sign in after confirming your email address.
                </AlertDescription>
              </Alert>
            ) : mode === "login" ? (
              <LoginForm
                onDone={() => navigate(destination, { replace: true })}
              />
            ) : (
              <RegisterForm
                onDone={() => navigate(destination, { replace: true })}
                onConfirmationRequired={setConfirmationEmail}
              />
            )}

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

function LoginForm({ onDone }: { onDone: () => void }) {
  const login = useLogin();
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const submit = form.handleSubmit(async (values) => {
    try {
      await login.mutateAsync(values);
      onDone();
    } catch {
      // Mutation state renders the server's safe error message.
    }
  });

  return (
    <Form {...form}>
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <TextField
          control={form.control}
          name="email"
          label="Email"
          type="email"
          autoComplete="email"
        />
        <TextField
          control={form.control}
          name="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          labelAside={
            <Link
              className="text-muted-foreground text-xs font-semibold underline underline-offset-4"
              to="/forgot-password"
            >
              Forgot password?
            </Link>
          }
        />
        <FormError error={login.error} />
        <Button type="submit" size="lg" disabled={login.isPending}>
          {login.isPending ? "Please wait…" : "Sign in"}
        </Button>
      </form>
    </Form>
  );
}

function RegisterForm({
  onDone,
  onConfirmationRequired,
}: {
  onDone: () => void;
  onConfirmationRequired: (email: string) => void;
}) {
  const register = useRegister();
  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { username: "", email: "", password: "" },
  });

  const submit = form.handleSubmit(async (values) => {
    try {
      const result = await register.mutateAsync(values);
      if (result.data.confirmationRequired) {
        onConfirmationRequired(values.email.toLowerCase());
        return;
      }
      onDone();
    } catch {
      // Mutation state renders the server's safe error message.
    }
  });

  return (
    <Form {...form}>
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <TextField
          control={form.control}
          name="username"
          label="Username"
          autoComplete="username"
          autoCapitalize="none"
          description="3–30 lowercase letters, numbers, or underscores."
        />
        <TextField
          control={form.control}
          name="email"
          label="Email"
          type="email"
          autoComplete="email"
        />
        <TextField
          control={form.control}
          name="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          description="Use at least 12 characters."
        />
        <FormError error={register.error} />
        <Button type="submit" size="lg" disabled={register.isPending}>
          {register.isPending ? "Please wait…" : "Create account"}
        </Button>
      </form>
    </Form>
  );
}
