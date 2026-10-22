import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PageHeader, SectionHeader } from "@/components/page";
import { ViewerShell } from "@/components/ViewerShell";
import { BETA, PAYOUT_TERMS, SITE } from "@/lib/site";

// Answers here restate the Terms and Refund Policy in plain words. When a
// policy or a number in lib/site.ts changes, check these still match.

function InlineLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="text-primary font-semibold underline-offset-4 hover:underline"
    >
      {children}
    </Link>
  );
}

const creatorSharePercent = BETA.active
  ? BETA.creatorSharePercent
  : PAYOUT_TERMS.creatorSharePercent;

type Question = { q: string; a: ReactNode };

const GROUPS: { title: string; questions: Question[] }[] = [
  {
    title: "The basics",
    questions: [
      {
        q: "What is Bling?",
        a: "Bling lets you talk live with creators. A creator opens their Hotline, fans ask to talk, and the creator picks who to call. Some creators take calls one-on-one; others put callers on their livestream for their audience to hear. Calls are audio only and happen right in your browser.",
      },
      {
        q: "What's a Hotline?",
        a: "A creator's own line on Bling. When it's live, anyone can send a request to talk. When it's off, you can follow the creator and we'll let you know when they go live.",
      },
      {
        q: "Do I need to download an app?",
        a: "No. Bling works in the browser on your phone or computer. You just need a microphone and to allow Bling to use it when your call starts.",
      },
      {
        q: "Who can use Bling?",
        a: "Anyone 18 or older.",
      },
    ],
  },
  {
    title: "Calling a creator",
    questions: [
      {
        q: "How do I get on a call?",
        a: "Open the page of a creator who's live, choose a call option, and add your name and what you want to talk about. The creator sees your request and can pick you. When they do, your call connects.",
      },
      {
        q: "Do I need an account?",
        a: "No. You can request a call as a guest. Make a free account if you want to follow creators and hear when they go live.",
      },
      {
        q: "Am I guaranteed a call? Where am I in line?",
        a: "There's no line. Requests wait together, and the creator chooses who to call, in any order. They may not get to everyone, so tell them what you want to talk about — a good topic helps.",
      },
      {
        q: "How long is a call?",
        a: "Each call option has its own length, set by the creator. The call ends on its own when time is up, and either of you can hang up sooner.",
      },
      {
        q: "Will other people hear my call?",
        a: "It depends on the creator. Some calls are one-on-one. Creators who are livestreaming may put your call on their stream, where their audience hears it. Check the creator's profile, and assume you could be on air if they're streaming.",
      },
      {
        q: "Are calls recorded?",
        a: "Bling doesn't record calls, and your microphone stays off until your call connects. If a creator puts you on their livestream, their stream may be saved or replayed on the platform they stream to.",
      },
    ],
  },
  {
    title: "Prices and payments",
    questions: [
      {
        q: "How much does a call cost?",
        a: "Each creator sets their own prices, and some offer free calls. You'll see the price before you send a request.",
      },
      {
        q: "When am I charged?",
        a: "Only if the creator picks you. When you request a paid call, we put a hold on your card for the price. If you withdraw or the Hotline ends before you're picked, the hold is released and you pay nothing.",
      },
      {
        q: "What if the call doesn't work?",
        a: (
          <>
            If you were charged but the call never connected, you're refunded in
            full automatically. If a call connected but something went wrong,
            email {SITE.supportEmail} within 30 days and we'll look into it. See
            the <InlineLink to="/refunds">Refund Policy</InlineLink>.
          </>
        ),
      },
    ],
  },
  {
    title: "For creators",
    questions: [
      {
        q: "How do I start my own Hotline?",
        a: (
          <>
            <InlineLink to="/register">Create an account</InlineLink>, set up
            your call options in the creator studio, and go live whenever you
            like. Share your Bling link so your audience knows where to find
            you.
          </>
        ),
      },
      {
        q: "Can I take calls on my livestream?",
        a: "Yes. Calls play in your browser, so add that browser's audio to your streaming software the way you would any other source, and your audience hears both sides. Say in your bio that calls may be on stream, so callers know before they ask.",
      },
      {
        q: "How much do I earn?",
        a: `You set your prices and keep ${creatorSharePercent}% of every paid call${BETA.active ? " — the beta rate, locked in when you sign up" : ""}. Stripe's card fee is split between you and Bling.`,
      },
      {
        q: "How do I get paid?",
        a: `Connect a bank account through Stripe in your studio. Earnings become available ${PAYOUT_TERMS.earningsHoldDays} days after each call and are paid out monthly once you have at least $${PAYOUT_TERMS.payoutMinimumDollars}.`,
      },
      {
        q: "Do I have to talk to everyone who asks?",
        a: "No. You see each caller's name and topic and pick who to talk to. You can end any call at any time and close your Hotline whenever you want.",
      },
    ],
  },
  {
    title: "Safety",
    questions: [
      {
        q: "How do I report someone?",
        a: (
          <>
            Email {SITE.supportEmail} with their username and what happened.
            Read what's not allowed in our{" "}
            <InlineLink to="/terms">Terms of Service</InlineLink>. If someone is
            in danger, contact your local emergency services first.
          </>
        ),
      },
      {
        q: "Does a creator see my phone number?",
        a: "No. Calls run through Bling, so no one ever sees a phone number. Creators see only the name and topic you send.",
      },
    ],
  },
];

export function FaqPage() {
  return (
    <ViewerShell>
      <article className="flex max-w-prose flex-col gap-(--section-gap)">
        <PageHeader
          eyebrow="Help"
          title="Frequently asked questions"
          description="How calls work, what they cost, and how to start your own Hotline."
        />

        {GROUPS.map((group) => (
          <section
            key={group.title}
            className="flex flex-col gap-(--stack-gap)"
          >
            <SectionHeader title={group.title} />
            <Card className="gap-0 py-0">
              <div className="divide-y">
                {group.questions.map(({ q, a }) => (
                  <details key={q} className="group">
                    <summary className="flex min-h-(--touch-min) cursor-pointer list-none items-center justify-between gap-3 px-(--card-pad) py-(--inset-pad) text-(length:--text-body) font-semibold [&::-webkit-details-marker]:hidden">
                      {q}
                      <ChevronDown
                        className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-180"
                        aria-hidden="true"
                      />
                    </summary>
                    <p className="text-muted-foreground px-(--card-pad) pb-(--card-pad) text-(length:--text-body) leading-relaxed">
                      {a}
                    </p>
                  </details>
                ))}
              </div>
            </Card>
          </section>
        ))}

        <p className="text-(length:--text-body)">
          Still stuck? <InlineLink to="/contact">Contact us</InlineLink> and
          we'll get back to you within two business days.
        </p>
      </article>
    </ViewerShell>
  );
}
