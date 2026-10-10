import { SITE } from "@/lib/site";
import { LegalPage, LegalSection, SupportEmail } from "./LegalPage";

// Written from what Bling actually stores and who processes it. Update it
// when a new provider (an email service, say) is added.

export function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      description="What Bling collects, why, and the choices you have."
    >
      <LegalSection title="What we collect">
        <ul>
          <li>
            <strong>Account details:</strong> your email address, username and
            password. Passwords are stored only as a secure hash.
          </li>
          <li>
            <strong>Profile:</strong> the display name, bio, profile picture and
            cover image you add. Published profiles are public.
          </li>
          <li>
            <strong>Call requests:</strong> the name and topic you send. The
            creator you request sees them.
          </li>
          <li>
            <strong>Activity:</strong> who you follow, notifications and whether
            you have read them, calls and their status and times, and visits to
            live channel pages (counted, not shown to anyone).
          </li>
          <li>
            <strong>Payments:</strong> amounts, fees, and payment, refund and
            dispute status. Card details go straight to Stripe; Bling never sees
            or stores full card numbers.
          </li>
          <li>
            <strong>Creator payouts:</strong> identity and bank details are
            collected and verified by Stripe. Bling keeps only the status of
            your payout account and the bank's name and last four digits.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Calls and audio">
        <p>
          Call audio travels directly between the two participants' devices, or
          through a relay server when networks require it, and is encrypted in
          transit. Bling does not record or store call audio. The technical
          messages that set up a call are deleted when the call ends.
        </p>
      </LegalSection>

      <LegalSection title="How we use it">
        <ul>
          <li>
            to run Bling: accounts, Hotlines, calls, follows and notifications;
          </li>
          <li>to process payments, refunds and creator payouts;</li>
          <li>to prevent fraud and abuse, and enforce our terms;</li>
          <li>to answer you when you contact us.</li>
        </ul>
        <p>We do not sell your personal information, and we do not show ads.</p>
      </LegalSection>

      <LegalSection title="Who processes it">
        <ul>
          <li>
            <strong>Stripe</strong>: payments and creator payouts. Stripe's
            checkout may collect device information to prevent fraud.
          </li>
          <li>
            <strong>Convex</strong>: our database and backend hosting.
          </li>
          <li>
            <strong>Vercel</strong>: hosting for the website.
          </li>
          <li>
            <strong>Network relay providers</strong>: help connect calls when a
            direct connection is not possible.
          </li>
        </ul>
        <p>
          We may share information if the law requires it, or to protect
          people's safety or the service.
        </p>
      </LegalSection>

      <LegalSection title="Your browser">
        <p>
          Bling stores a small amount of data in your browser to keep you signed
          in (or to keep a caller's request across refreshes) and to remember
          your theme. We do not use advertising or tracking cookies.
        </p>
      </LegalSection>

      <LegalSection title="How long we keep it">
        <ul>
          <li>Account and profile details: until you close your account.</li>
          <li>Notifications: 30 days.</li>
          <li>
            Payment records: as long as tax and financial rules require, even
            after an account closes.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Your choices">
        <p>
          You can edit your profile, unpublish it, and unfollow creators at any
          time. To get a copy of your data, correct it, or delete your account,
          email <SupportEmail />. We will respond within 30 days. Bling is for
          adults; we do not knowingly collect information from anyone under 18.
        </p>
      </LegalSection>

      <LegalSection title="Changes and contact">
        <p>
          If we change this policy in a significant way, we will tell you on the
          site or by email. {SITE.name} is operated by {SITE.operator}. Privacy
          questions: <SupportEmail />.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
