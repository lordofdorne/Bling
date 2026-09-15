import { useMemo, useState } from "react";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { CreditCard, Plus } from "lucide-react";
import {
  PaymentMethodSetup,
  usePaymentMethods,
  usePaymentMethodSetup,
  useRefreshPaymentMethods,
  useRemovePaymentMethod,
} from "../../lib/payments";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

function SavePaymentMethodForm({
  onSaved,
  onCancel,
}: {
  onSaved: () => void;
  onCancel: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError("");
    const result = await stripe.confirmSetup({
      elements,
      redirect: "if_required",
      confirmParams: {
        return_url: window.location.href,
        payment_method_data: { allow_redisplay: "always" },
      },
    });
    if (result.error) {
      setError(result.error.message ?? "Unable to save this payment method.");
      setSubmitting(false);
      return;
    }
    if (result.setupIntent?.status !== "succeeded") {
      setError("Payment setup is still incomplete. Try again.");
      setSubmitting(false);
      return;
    }
    onSaved();
  }

  return (
    <div className="flex flex-col gap-4">
      <PaymentElement options={{ layout: "tabs" }} />
      <p className="text-muted-foreground text-xs">
        Stripe securely stores your payment details. Bling never receives your
        full card number or CVC.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button type="button" onClick={save} disabled={!stripe || submitting}>
          {submitting ? "Saving…" : "Save payment method"}
        </Button>
        <Button
          variant="secondary"
          type="button"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </Button>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function PaymentMethodSetupPanel({
  setup,
  onSaved,
  onCancel,
}: {
  setup: PaymentMethodSetup;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const stripePromise = useMemo(
    () => loadStripe(setup.publishableKey),
    [setup.publishableKey],
  );
  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret: setup.clientSecret,
        customerSessionClientSecret: setup.customerSessionClientSecret,
        appearance: { theme: "stripe" },
      }}
    >
      <SavePaymentMethodForm onSaved={onSaved} onCancel={onCancel} />
    </Elements>
  );
}

export function PaymentSettings() {
  const methods = usePaymentMethods();
  const setup = usePaymentMethodSetup();
  const remove = useRemovePaymentMethod();
  const refresh = useRefreshPaymentMethods();

  async function saved() {
    setup.reset();
    await refresh();
  }

  return (
    <section aria-label="Saved payments" className="flex flex-col gap-6">
      <header>
        <h2 className="text-xl font-bold tracking-tight">Payment methods</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Save a card for faster call requests and manage it here.
        </p>
      </header>

      <Card>
        <CardContent className="flex flex-col gap-4">
          {setup.data ? (
            <PaymentMethodSetupPanel
              setup={setup.data}
              onSaved={() => void saved()}
              onCancel={() => setup.reset()}
            />
          ) : (
            <>
              {methods.isPending ? (
                <p className="text-muted-foreground text-sm">
                  Loading saved payment methods…
                </p>
              ) : methods.isError ? (
                <Alert variant="destructive">
                  <AlertDescription>
                    Unable to load saved payment methods.
                  </AlertDescription>
                </Alert>
              ) : methods.data.length === 0 ? (
                <div className="flex items-center gap-4 py-2">
                  <span className="bg-muted text-muted-foreground grid size-10 place-items-center rounded-lg">
                    <CreditCard className="size-5" />
                  </span>
                  <div>
                    <strong className="text-sm">
                      No saved payment methods
                    </strong>
                    <p className="text-muted-foreground text-xs">
                      Add a card now or save one during your next paid call.
                    </p>
                  </div>
                </div>
              ) : (
                <ul className="flex flex-col">
                  {methods.data.map((method) => (
                    <li
                      className="flex items-center gap-4 border-b py-4 first:pt-0 last:border-b-0 last:pb-0"
                      key={method.id}
                    >
                      <span className="bg-muted grid size-10 place-items-center rounded-lg text-sm font-bold uppercase">
                        {method.brand.slice(0, 1)}
                      </span>
                      <div className="flex-1">
                        <strong className="text-sm capitalize">
                          {method.brand.replaceAll("_", " ")} ••••{" "}
                          {method.last4}
                        </strong>
                        <p className="text-muted-foreground text-xs">
                          Expires {String(method.expMonth).padStart(2, "0")}/
                          {String(method.expYear).slice(-2)}
                        </p>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        type="button"
                        onClick={() => remove.mutate(method.id)}
                        disabled={remove.isPending}
                        aria-label={`Remove ${method.brand} ending in ${method.last4}`}
                      >
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <Button
                type="button"
                className="w-fit"
                variant={methods.data?.length ? "secondary" : "default"}
                onClick={() => setup.mutate()}
                disabled={setup.isPending}
              >
                <Plus className="size-4" />
                {setup.isPending
                  ? "Opening secure form…"
                  : "Add payment method"}
              </Button>
              {(setup.isError || remove.isError) && (
                <Alert variant="destructive">
                  <AlertDescription>
                    {setup.error?.message ?? remove.error?.message}
                  </AlertDescription>
                </Alert>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
