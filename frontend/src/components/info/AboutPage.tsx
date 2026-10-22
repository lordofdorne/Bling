import { Link } from "react-router-dom";
import { ArrowRight, Headphones, Radio, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader, SectionHeader } from "@/components/page";
import { ViewerShell } from "@/components/ViewerShell";
import { BETA, PAYOUT_TERMS } from "@/lib/site";

const creatorSharePercent = BETA.active
  ? BETA.creatorSharePercent
  : PAYOUT_TERMS.creatorSharePercent;

const PILLARS = [
  {
    Icon: Headphones,
    title: "For fans",
    body: "Comments scroll past and DMs go unread. On Bling you get a real conversation: a few minutes one-on-one, or your moment on their stream.",
  },
  {
    Icon: Radio,
    title: "For creators",
    body: `Take calls one-on-one or put fans on your livestream. Open your Hotline whenever you like, choose who you talk to, and set your own prices. You keep ${creatorSharePercent}% of every paid call.`,
  },
  {
    Icon: ShieldCheck,
    title: "Safe by design",
    body: "Calls are audio only and Bling never records them. Creators decide who they call, either side can hang up, and you're only charged for calls that connect.",
  },
];

export function AboutPage() {
  return (
    <ViewerShell>
      <article className="flex max-w-prose flex-col gap-(--section-gap)">
        <PageHeader
          eyebrow="About Bling"
          title="Talk live with the creators you follow."
          description="Bling turns a creator's audience into live voice calls — one-on-one or on their livestream — without anyone handing out a phone number."
        />

        <section className="flex flex-col gap-(--stack-gap) text-(length:--text-body) leading-relaxed">
          <p>
            Social media made creators easy to follow and hard to reach.
            Comments pile up, DMs go unread, and the people who care most rarely
            get a real conversation.
          </p>
          <p>
            Bling gives every creator their own line. When they go live, fans
            ask to talk and say what's on their mind, and the creator picks who
            to call. Some creators use it for one-on-one conversations. Others
            are livestreaming and put callers on air, so their whole audience
            hears the call. Either way it runs in the browser — no app to
            install, no number to share.
          </p>
        </section>

        <section className="flex flex-col gap-(--stack-gap)">
          <SectionHeader title="What we care about" />
          <Card className="gap-0 py-0">
            <ul className="divide-y">
              {PILLARS.map(({ Icon, title, body }) => (
                <li key={title} className="flex gap-3 p-(--card-pad)">
                  <span className="bg-[var(--mauve-surface)] text-primary grid size-(--icon-button) shrink-0 place-items-center rounded-lg">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <div className="flex min-w-0 flex-col gap-1">
                    <h3 className="text-(length:--text-card-title) font-bold">
                      {title}
                    </h3>
                    <p className="text-muted-foreground text-(length:--text-body)">
                      {body}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </section>

        {BETA.active && (
          <section className="flex flex-col gap-(--stack-gap)">
            <SectionHeader title="We're in beta" />
            <p className="text-(length:--text-body) leading-relaxed">
              Bling is new and still growing. Creators who join during the beta
              keep {BETA.creatorSharePercent}% of every paid call, a rate locked
              in when they sign up. Tell us what's working and what isn't — we
              read everything at the{" "}
              <Link
                to="/contact"
                className="text-primary font-semibold underline-offset-4 hover:underline"
              >
                contact page
              </Link>
              .
            </p>
          </section>
        )}

        <div className="flex flex-col gap-2 tablet:flex-row">
          <Button
            asChild
            variant="secondary"
            size="lg"
            className="w-full tablet:w-auto"
          >
            <Link to="/faq">Read the FAQ</Link>
          </Button>
          <Button asChild size="lg" className="w-full tablet:w-auto">
            <Link to="/register">
              Open your Hotline
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </article>
    </ViewerShell>
  );
}
