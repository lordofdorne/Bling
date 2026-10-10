import { LegalPage, LegalSection, PolicyLink, SupportEmail } from "./LegalPage";

// Each case here is what the backend does automatically
// (convex/payments.ts, convex/lib/payments.ts, convex/refunds.ts).

export function RefundPage() {
  return (
    <LegalPage
      title="Refund Policy"
      description="When you are charged for a paid call, and when you get your money back."
    >
      <LegalSection title="You pay only for calls that happen">
        <p>
          When you request a paid call, your card is authorized for the tier
          price. That is a hold, not a charge. You are charged only when the
          creator picks you.
        </p>
      </LegalSection>

      <LegalSection title="Automatic releases and refunds">
        <ul>
          <li>
            <strong>You withdraw your request</strong> before being picked: the
            hold is released and you are not charged.
          </li>
          <li>
            <strong>The Hotline ends</strong> before you are picked: the hold is
            released and you are not charged.
          </li>
          <li>
            <strong>You are picked but the call never connects</strong>, for
            example the creator ends it or the connection fails before you talk:
            you are refunded in full, automatically.
          </li>
          <li>
            <strong>
              The Hotline ends while your payment is going through
            </strong>
            : you are refunded in full, automatically.
          </li>
        </ul>
        <p>
          Released holds usually disappear within a few days, depending on your
          bank. Refunds usually reach your card in 5–10 business days.
        </p>
      </LegalSection>

      <LegalSection title="Calls that connected">
        <p>
          Once a call has connected, the charge is final, including when it ends
          early. If something went wrong, such as the call dropping straight
          away or the creator breaking our{" "}
          <PolicyLink to="/terms">Terms of Service</PolicyLink>, email{" "}
          <SupportEmail /> within 30 days and we will review it. If we refund
          you, the creator's earnings for that call are reversed.
        </p>
      </LegalSection>

      <LegalSection title="Disputes">
        <p>
          Please contact us before disputing a charge with your bank; most
          problems are quicker to fix directly. Charges appear on your statement
          as BLING HOTLINE.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
