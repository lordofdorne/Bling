import { Mail } from "lucide-react";
import { Card } from "@/components/ui/card";
import { SITE } from "@/lib/site";
import { LegalPage, LegalSection, PolicyLink, SupportEmail } from "./LegalPage";

export function ContactPage() {
  return (
    <LegalPage
      title="Contact"
      description="Questions, problems with a call or payment, or a safety report."
    >
      <Card className="flex-row items-center gap-(--stack-gap)">
        <span className="bg-[var(--mauve-surface)] text-primary grid size-(--control-lg-height) shrink-0 place-items-center rounded-lg">
          <Mail className="size-5" aria-hidden="true" />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-muted-foreground text-(length:--text-meta)">
            Email us
          </p>
          <a
            className="text-(length:--text-card-title) truncate font-bold underline-offset-4 hover:underline"
            href={`mailto:${SITE.supportEmail}`}
          >
            {SITE.supportEmail}
          </a>
        </div>
      </Card>

      <LegalSection title="We can help with">
        <ul>
          <li>
            a charge, refund or card hold, so include the creator's name and the
            date;
          </li>
          <li>creator payouts and payout setup;</li>
          <li>your account, or closing it;</li>
          <li>
            reporting someone who broke our{" "}
            <PolicyLink to="/terms">Terms of Service</PolicyLink>, with their
            username and what happened.
          </li>
        </ul>
        <p>
          We aim to reply within two business days. If someone is in danger,
          contact your local emergency services first.
        </p>
      </LegalSection>

      <LegalSection title="Policies">
        <p>
          Read our <PolicyLink to="/terms">Terms of Service</PolicyLink>,{" "}
          <PolicyLink to="/privacy">Privacy Policy</PolicyLink> and{" "}
          <PolicyLink to="/refunds">Refund Policy</PolicyLink>, or write to{" "}
          <SupportEmail />.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
