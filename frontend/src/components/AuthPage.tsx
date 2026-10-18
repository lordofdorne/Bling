import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, Sparkles } from "lucide-react";
import { useLogin, useMe, useRegister } from "../lib/auth";
import {
  loginSchema,
  registerSchema,
  type LoginValues,
  type RegisterValues,
} from "../lib/schemas";
import { BETA, PAYOUT_TERMS } from "../lib/site";
import { Brand } from "./ViewerShell";
import { FormError, TextField } from "./form-fields";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
    <main className="min-h-screen pt-(--safe-top) pb-(--safe-bottom)">
      <header className="flex h-(--header-height) items-center justify-between px-(--page-pad)">
        <Brand />
        <Button asChild variant="link">
          <Link to="/">
            Back to discover <ArrowRight className="size-4" />
          </Link>
        </Button>
      </header>

      <div className="mx-auto grid w-full max-w-5xl gap-10 px-(--page-pad) pt-(--stack-gap) pb-(--section-gap) laptop:min-h-[calc(100vh-var(--header-height)*2)] laptop:grid-cols-2 laptop:items-center">
        <section className="laptop:block hidden">
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
        </section>

        <Card className="max-tablet:border-0 max-tablet:bg-transparent max-tablet:py-0 w-full">
          <CardContent className="max-tablet:px-0 flex flex-col gap-(--card-gap)">
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
              <>
                {BETA.active && !viewerIntent && (
                  <Alert role="note" className="border-(--sand)">
                    <Sparkles />
                    <AlertTitle>Bling is in beta</AlertTitle>
                    <AlertDescription>
                      Creators who sign up now keep {BETA.creatorSharePercent}%
                      of every paid call, instead of the usual{" "}
                      {PAYOUT_TERMS.creatorSharePercent}%.
                    </AlertDescription>
                  </Alert>
                )}
                <RegisterForm
                  onDone={() => navigate(destination, { replace: true })}
                  onConfirmationRequired={setConfirmationEmail}
                />
              </>
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
        <p className="text-muted-foreground text-center text-(length:--text-meta)">
          By creating an account you agree to the{" "}
          <Link
            to="/terms"
            className="text-foreground underline underline-offset-4"
          >
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link
            to="/privacy"
            className="text-foreground underline underline-offset-4"
          >
            Privacy Policy
          </Link>
          .
        </p>
      </form>
    </Form>
  );
}
