import { useMemo, useState } from "react";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useStripeAppearance } from "../../lib/stripe-appearance";
import { CreditCard, Plus } from "lucide-react";
import type { PaymentActivity } from "../../lib/finance";
import {
  PaymentMethodSetup,
  usePaymentMethods,
  usePaymentMethodSetup,
  useRefreshPaymentMethods,
  useRemovePaymentMethod,
} from "../../lib/payments";
import { usePaymentActivity } from "../../lib/finance";
import { formatDate, formatPrice } from "./format";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SectionHeader } from "../page";
import { useControlSize } from "../../lib/design";

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
  const controlSize = useControlSize();

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
      <div className="flex flex-col-reverse gap-2 tablet:flex-row">
        <Button
          type="button"
          size={controlSize}
          onClick={save}
          disabled={!stripe || submitting}
        >
          {submitting ? "Saving…" : "Save payment method"}
        </Button>
        <Button
          variant="secondary"
          type="button"
          size={controlSize}
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
  const appearance = useStripeAppearance().elements;
  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret: setup.clientSecret,
        customerSessionClientSecret: setup.customerSessionClientSecret,
        appearance,
      }}
    >
      <SavePaymentMethodForm onSaved={onSaved} onCancel={onCancel} />
    </Elements>
  );
}

// Payments: the cards you call with, and the paid calls your Hotline has
// taken (as a table on tablet and up, compact rows on phones).

export function PaymentSettings() {
  return (
    <div className="flex flex-col gap-(--stack-gap)">
      <PaymentMethodsCard />
      <PaymentsReceivedCard />
    </div>
  );
}

// ------------------------------------------------------------ methods

type SavedMethod = {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
};

const brandName = (brand: string) =>
  brand.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

function PaymentMethodsCard() {
  const methods = usePaymentMethods();
  const setup = usePaymentMethodSetup();
  const remove = useRemovePaymentMethod();
  const refresh = useRefreshPaymentMethods();
  const controlSize = useControlSize();
  const [removing, setRemoving] = useState<SavedMethod | null>(null);

  async function saved() {
    setup.reset();
    await refresh();
  }

  return (
    <Card aria-label="Saved payments">
      <CardContent className="flex flex-col gap-(--card-gap)">
        <SectionHeader
          title="Payment methods"
          description="Cards saved for faster call requests."
          action={
            !setup.data &&
            !!methods.data?.length && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setup.mutate()}
                disabled={setup.isPending}
              >
                <Plus className="size-4" />
                {setup.isPending ? "Opening…" : "Add card"}
              </Button>
            )
          }
        />

        {setup.data ? (
          <PaymentMethodSetupPanel
            setup={setup.data}
            onSaved={() => void saved()}
            onCancel={() => setup.reset()}
          />
        ) : methods.isPending ? null : methods.isError ? (
          <Alert variant="destructive">
            <AlertDescription>
              Unable to load saved payment methods.
            </AlertDescription>
          </Alert>
        ) : methods.data.length === 0 ? (
          <div className="flex flex-col gap-(--card-gap) tablet:flex-row tablet:items-center tablet:justify-between">
            <div className="flex items-center gap-3">
              <CardIcon />
              <p className="text-muted-foreground text-(length:--text-body)">
                No saved cards. Add one now, or save one during your next paid
                call.
              </p>
            </div>
            <Button
              type="button"
              size={controlSize}
              className="w-full tablet:w-auto"
              onClick={() => setup.mutate()}
              disabled={setup.isPending}
            >
              <Plus className="size-4" />
              {setup.isPending ? "Opening secure form…" : "Add card"}
            </Button>
          </div>
        ) : (
          <ul className="divide-y border-y">
            {methods.data.map((method) => (
              <li key={method.id} className="flex items-center gap-3 py-3">
                <CardIcon />
                <div className="min-w-0 flex-1">
                  <strong className="block truncate font-semibold">
                    {brandName(method.brand)} •••• {method.last4}
                  </strong>
                  <span className="text-muted-foreground text-(length:--text-meta)">
                    Expires {String(method.expMonth).padStart(2, "0")}/
                    {String(method.expYear).slice(-2)}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={() => setRemoving(method)}
                  aria-label={`Remove ${brandName(method.brand)} ending in ${method.last4}`}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}

        {(setup.isError || remove.isError) && (
          <Alert variant="destructive">
            <AlertDescription>
              {setup.error?.message ?? remove.error?.message}
            </AlertDescription>
          </Alert>
        )}

        <Dialog
          open={removing !== null}
          onOpenChange={(open) => !open && setRemoving(null)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                Remove {removing && brandName(removing.brand)} ending in{" "}
                {removing?.last4}?
              </DialogTitle>
              <DialogDescription>
                You can add it again during your next paid call.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="secondary" size={controlSize} type="button">
                  Cancel
                </Button>
              </DialogClose>
              <Button
                variant="destructive"
                size={controlSize}
                type="button"
                disabled={remove.isPending}
                onClick={() =>
                  removing &&
                  remove.mutate(removing.id, {
                    onSettled: () => setRemoving(null),
                  })
                }
              >
                {remove.isPending ? "Removing…" : "Remove card"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

function CardIcon() {
  return (
    <span className="bg-muted text-muted-foreground grid size-10 shrink-0 place-items-center rounded-lg">
      <CreditCard className="size-5" />
    </span>
  );
}

// ------------------------------------------------------------ received

function paymentStatus(payment: PaymentActivity) {
  if (payment.disputeStatus)
    return { label: "Disputed", variant: "destructive" as const, earns: false };
  if (payment.refundStatus === "SUCCEEDED")
    return { label: "Refunded", variant: "outline" as const, earns: false };
  if (payment.refundStatus === "FAILED")
    return {
      label: "Refund failed",
      variant: "destructive" as const,
      earns: true,
    };
  if (payment.refundStatus)
    return { label: "Refunding", variant: "outline" as const, earns: false };
  return { label: "Paid", variant: "success" as const, earns: true };
}

/** Bling's share plus the creator's half of the card fee. */
const feesOf = (payment: PaymentActivity) => payment.platformFeeCents;
const earnedOf = (payment: PaymentActivity) =>
  payment.amountCents - payment.platformFeeCents;

function PaymentsReceivedCard() {
  const paymentActivity = usePaymentActivity();
  const payments = paymentActivity.data?.activity ?? [];

  return (
    <Card aria-label="Payment activity">
      <CardContent className="flex flex-col gap-(--card-gap)">
        <SectionHeader
          title="Payments received"
          description="Paid calls on your Hotline, newest first. Fees are Bling's share and your half of the card fee."
        />
        {paymentActivity.isPending ? null : paymentActivity.isError ? (
          <Alert variant="destructive">
            <AlertDescription>
              Unable to load payment activity.
            </AlertDescription>
          </Alert>
        ) : payments.length === 0 ? (
          <p className="text-muted-foreground text-(length:--text-body)">
            No paid calls yet. Your first one will appear here.
          </p>
        ) : (
          <>
            {/* Phones: compact rows. */}
            <ul className="-mx-(--card-pad) divide-y border-t tablet:hidden">
              {payments.map((payment) => {
                const status = paymentStatus(payment);
                return (
                  <li
                    key={payment.paymentAttemptId}
                    className="flex items-center gap-3 px-(--card-pad) py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <strong className="block font-semibold tabular-nums">
                        {formatPrice(payment.amountCents)}
                      </strong>
                      <small className="text-muted-foreground text-(length:--text-meta)">
                        {formatDate(payment.createdAt)} · You earn{" "}
                        {status.earns ? formatPrice(earnedOf(payment)) : "—"}
                      </small>
                    </div>
                    <Badge variant={status.variant}>{status.label}</Badge>
                  </li>
                );
              })}
            </ul>

            {/* Tablet and up: a table. */}
            <div className="-mx-(--card-pad) max-tablet:hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-(--card-pad)">Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Fees</TableHead>
                    <TableHead className="pr-(--card-pad) text-right">
                      You earn
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map((payment) => {
                    const status = paymentStatus(payment);
                    return (
                      <TableRow key={payment.paymentAttemptId}>
                        <TableCell className="text-muted-foreground pl-(--card-pad)">
                          {formatDate(payment.createdAt)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={status.variant}>{status.label}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatPrice(payment.amountCents)}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-right tabular-nums">
                          −{formatPrice(feesOf(payment))}
                        </TableCell>
                        <TableCell className="pr-(--card-pad) text-right font-semibold tabular-nums">
                          {status.earns ? formatPrice(earnedOf(payment)) : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
