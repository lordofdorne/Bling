import { BETA, PAYOUT_TERMS, SITE } from "@/lib/site";
import { LegalPage, LegalSection, PolicyLink, SupportEmail } from "./LegalPage";

// Starting-point terms written from how Bling works. Have them reviewed by a
// lawyer before relying on them (governing law, dispute resolution and
// liability caps in particular depend on where the operator is based).

export function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      description="The agreement between you and Bling when you use the site."
    >
      <LegalSection title="1. Who we are">
        <p>
          {SITE.name} ({SITE.url}) is operated by {SITE.operator} ("Bling",
          "we", "us"). Bling lets creators open a Hotline, a live line their
          audience can request to call, and talk with the callers they choose
          over live audio.
        </p>
        <p>
          By using Bling you agree to these terms, our{" "}
          <PolicyLink to="/privacy">Privacy Policy</PolicyLink> and our{" "}
          <PolicyLink to="/refunds">Refund Policy</PolicyLink>. If you do not
          agree, do not use Bling.
        </p>
      </LegalSection>

      <LegalSection title="2. Eligibility and accounts">
        <ul>
          <li>You must be at least 18 years old to use Bling.</li>
          <li>
            Creators need an account. Callers can request a call without one;
            your browser then keeps a private session so your request survives a
            refresh.
          </li>
          <li>
            Keep your login details secure. You are responsible for activity on
            your account. Tell us at <SupportEmail /> if you think someone else
            has used it.
          </li>
          <li>Give accurate information, and keep it up to date.</li>
        </ul>
      </LegalSection>

      <LegalSection title="3. How calls work">
        <ul>
          <li>
            A creator opens a Hotline and sets one or more tiers, each with a
            call length and a price (which may be free).
          </li>
          <li>
            Callers send a request with a name and topic. Requests are a holding
            place, not a line: the creator chooses whom to call, in any order,
            and may not call everyone. Joining never guarantees a call.
          </li>
          <li>
            A call lasts at most its tier's length and ends automatically when
            time runs out. Either side can end it sooner.
          </li>
          <li>
            Calls are live audio between the two participants. Your microphone
            turns on only after you allow it. Bling does not record calls.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="4. Paid calls">
        <ul>
          <li>
            For a paid tier, your card is authorized for the tier price when you
            send your request. You are charged only if the creator picks you.
          </li>
          <li>
            If you withdraw your request, or the Hotline ends before you are
            picked, the authorization is released and you are not charged.
          </li>
          <li>
            If you are charged but the call never connects, you are refunded in
            full automatically. See the{" "}
            <PolicyLink to="/refunds">Refund Policy</PolicyLink>.
          </li>
          <li>
            Payments are processed by Stripe. Bling never sees or stores your
            full card number. Prices are in US dollars.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="5. Creators">
        <ul>
          <li>
            Before offering paid tiers, creators set up payouts through Stripe,
            which verifies identity and bank details. You agree to Stripe's
            Connected Account Agreement as part of that setup.
          </li>
          <li>
            For each paid call that connects, you earn{" "}
            {PAYOUT_TERMS.creatorSharePercent}% of the price, less half of
            Stripe's standard card fee (2.9% + 30¢). Bling keeps{" "}
            {PAYOUT_TERMS.platformSharePercent}% and pays the other half of the
            fee.
          </li>
          <li>
            Bling is in beta. Creators who sign up during the beta earn{" "}
            {BETA.creatorSharePercent}% of the price instead, and Bling keeps{" "}
            {BETA.platformSharePercent}%; the card fee is split the same way.
            Your rate is set when you create your account and shown in your
            payout settings.
          </li>
          <li>
            Earnings become available {PAYOUT_TERMS.earningsHoldDays} days after
            the call. Available balances of at least $
            {PAYOUT_TERMS.payoutMinimumDollars} are paid out monthly; smaller
            balances carry over.
          </li>
          <li>
            If a payment is refunded or disputed, the matching earnings are
            reversed or held until the dispute is resolved. A negative balance
            is recovered from future earnings.
          </li>
          <li>
            You are responsible for your own taxes, and for what you say and do
            on calls.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="6. Content and conduct">
        <p>
          On Bling, including in names, topics, profiles and calls, you must
          not:
        </p>
        <ul>
          <li>
            share sexual or sexually explicit content, or offer sexual services;
          </li>
          <li>
            harass, threaten, bully, or demean anyone, including for who they
            are;
          </li>
          <li>involve anyone under 18 in a call;</li>
          <li>
            promote violence, self-harm, or illegal activity, or sell regulated
            goods;
          </li>
          <li>impersonate someone, or mislead callers about who you are;</li>
          <li>
            record others without their consent where the law requires it;
          </li>
          <li>spam, scam, or try to take payments outside Bling;</li>
          <li>
            interfere with the service, or access it in ways we do not offer.
          </li>
        </ul>
        <p>
          Report a problem at <SupportEmail />. We may remove content, end calls
          or Hotlines, withhold payouts for transactions that break these terms,
          and suspend or close accounts.
        </p>
      </LegalSection>

      <LegalSection title="7. Your content">
        <p>
          You keep ownership of what you post, such as your profile, photos and
          bio. You give Bling permission to host and display it so the service
          works, for as long as it is on Bling.
        </p>
      </LegalSection>

      <LegalSection title="8. Changes and ending">
        <p>
          We may change Bling or these terms. If a change is significant, we
          will tell you on the site or by email before it takes effect. You can
          stop using Bling at any time, and ask us to close your account at{" "}
          <SupportEmail />. Creators are paid any earnings due under section 5,
          less refunds and disputes.
        </p>
      </LegalSection>

      <LegalSection title="9. Disclaimers and liability">
        <p>
          Bling is provided "as is". Calls depend on networks and devices we do
          not control, and we do not promise uninterrupted service. Creators and
          callers are responsible for their own conversations; Bling does not
          endorse what is said on calls.
        </p>
        <p>
          To the extent the law allows, Bling is not liable for indirect or
          consequential losses, and our total liability to you is limited to the
          amount you paid Bling in the 12 months before the claim. Nothing in
          these terms limits rights you have under consumer law.
        </p>
      </LegalSection>

      <LegalSection title="10. Contact">
        <p>
          Questions about these terms: <SupportEmail />.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
