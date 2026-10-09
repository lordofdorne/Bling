import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useForgotPassword, useResetPassword } from "../lib/auth";
import {
  forgotPasswordSchema,
  resetPasswordSchema,
  type ForgotPasswordValues,
  type ResetPasswordValues,
} from "../lib/schemas";
import { Brand } from "./ViewerShell";
import { FormError, TextField } from "./form-fields";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Form } from "@/components/ui/form";

type PasswordRecoveryPageProps = { mode: "forgot" | "reset" };

export function PasswordRecoveryPage({ mode }: PasswordRecoveryPageProps) {
  const [submitted, setSubmitted] = useState(false);

  return (
    <main className="min-h-screen pt-(--safe-top) pb-(--safe-bottom)">
      <header className="flex h-(--header-height) items-center justify-between px-(--page-pad)">
        <Brand />
        <Button asChild variant="link">
          <Link to="/login">
            <ArrowLeft className="size-4" /> Back to sign in
          </Link>
        </Button>
      </header>

      <div className="mx-auto flex w-full max-w-md px-(--page-pad) pt-(--stack-gap) pb-(--section-gap) tablet:pt-(--space-9)">
        <Card className="max-tablet:border-0 max-tablet:bg-transparent max-tablet:py-0 w-full">
          <CardContent className="max-tablet:px-0 flex flex-col gap-(--card-gap)">
            <div>
              <p className="text-[var(--sand-text)] text-xs font-bold tracking-[0.14em] uppercase">
                Account recovery
              </p>
              <h1 className="mt-2 text-2xl font-extrabold tracking-tight">
                {mode === "forgot"
                  ? "Reset your password."
                  : "Choose a new password."}
              </h1>
              <p className="text-muted-foreground mt-2 text-sm">
                {mode === "forgot"
                  ? "Enter your email and we’ll send a secure reset link if an account exists."
                  : "Use at least 12 characters for your new password."}
              </p>
            </div>

            {submitted ? (
              <>
                <Alert>
                  <AlertDescription>
                    {mode === "forgot"
                      ? "If an account exists for that email, a password reset link is on its way."
                      : "Your password has been updated. You can now sign in."}
                  </AlertDescription>
                </Alert>
                <Button asChild variant="secondary">
                  <Link to="/login">Return to sign in</Link>
                </Button>
              </>
            ) : mode === "forgot" ? (
              <ForgotPasswordForm onDone={() => setSubmitted(true)} />
            ) : (
              <ResetPasswordForm onDone={() => setSubmitted(true)} />
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function ForgotPasswordForm({ onDone }: { onDone: () => void }) {
  const forgot = useForgotPassword();
  const form = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  const submit = form.handleSubmit(async ({ email }) => {
    try {
      await forgot.mutateAsync(email);
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
        <FormError error={forgot.error} />
        <Button type="submit" size="lg" disabled={forgot.isPending}>
          {forgot.isPending ? "Please wait…" : "Send reset link"}
        </Button>
      </form>
    </Form>
  );
}

function ResetPasswordForm({ onDone }: { onDone: () => void }) {
  const reset = useResetPassword();
  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirmation: "" },
  });

  const submit = form.handleSubmit(async ({ password }) => {
    try {
      await reset.mutateAsync(password);
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
          name="password"
          label="New password"
          type="password"
          autoComplete="new-password"
        />
        <TextField
          control={form.control}
          name="confirmation"
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
        />
        <FormError error={reset.error} />
        <Button type="submit" size="lg" disabled={reset.isPending}>
          {reset.isPending ? "Please wait…" : "Update password"}
        </Button>
      </form>
    </Form>
  );
}
