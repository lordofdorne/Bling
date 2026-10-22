import type { LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BadgeDollarSign,
  CalendarCheck,
  CreditCard,
  Gift,
  Hand,
  Landmark,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader, SectionHeader } from "@/components/page";
import { ViewerShell } from "@/components/ViewerShell";
import { formatPrice } from "@/components/studio/format";
import { BETA, PAYOUT_TERMS, creatorTakeHomeCents } from "@/lib/site";

// Pricing for both sides, in plain words. Every number comes from
// lib/site.ts; the earnings examples use the same fee formula as payouts.

const creatorSharePercent = BETA.active
  ? BETA.creatorSharePercent
  : PAYOUT_TERMS.creatorSharePercent;

/** Example call prices for the earnings table. Creators set their own. */
const EXAMPLE_PRICES_CENTS = [500, 1000, 2500];

type Point = { Icon: LucideIcon; title: string; body: string };

const FOR_CALLERS: Point[] = [
  {
    Icon: BadgeDollarSign,
    title: "Creators set the price",
    body: "Each call option shows its price and length before you ask. Nothing is hidden.",
  },
  {
    Icon: Gift,
    title: "Some calls are free",
    body: "Creators can offer free calls alongside paid ones.",
  },
  {
    Icon: Hand,
    title: "Charged only if you're picked",
    body: "A paid request puts a hold on your card. If you withdraw, or the Hotline ends before you're picked, the hold is released.",
  },
  {
    Icon: RotateCcw,
    title: "Refunded if it doesn't connect",
    body: "If you're charged and the call never connects, you get your money back automatically.",
  },
];

const FOR_CREATORS: Point[] = [
  {
    Icon: Sparkles,
    title: "Free to start",
    body: "No sign-up fee, no monthly fee. Open your Hotline whenever you like.",
  },
  {
    Icon: CreditCard,
    title: `Keep ${creatorSharePercent}% of every paid call`,
    body: BETA.active
      ? `The beta rate, locked in when you sign up. Creators who join after the beta keep ${PAYOUT_TERMS.creatorSharePercent}%. Stripe's card fee is split between you and Bling.`
      : "Stripe's card fee is split between you and Bling.",
  },
  {
    Icon: Landmark,
    title: "Paid monthly to your bank",
    body: `Earnings become available ${PAYOUT_TERMS.earningsHoldDays} days after each call and are paid out monthly once you have $${PAYOUT_TERMS.payoutMinimumDollars} or more.`,
  },
  {
    Icon: CalendarCheck,
    title: "Free calls cost nothing",
    body: "Offer free calls to grow your audience. Bling takes nothing from them.",
  },
];

function PointList({ points }: { points: Point[] }) {
  return (
    <Card className="gap-0 py-0">
      <ul className="divide-y">
        {points.map(({ Icon, title, body }) => (
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
  );
}

export function PricingPage() {
  return (
    <ViewerShell>
      <article className="flex max-w-prose flex-col gap-(--section-gap)">
        <PageHeader
          eyebrow="Pricing"
          title={`Free to start. Creators keep ${creatorSharePercent}%.`}
          description="Creators set their own prices. Callers pay only when a creator picks them."
        />

        <section className="flex flex-col gap-(--stack-gap)">
          <SectionHeader title="For callers" />
          <PointList points={FOR_CALLERS} />
        </section>

        <section className="flex flex-col gap-(--stack-gap)">
          <SectionHeader title="For creators" />
          <PointList points={FOR_CREATORS} />
        </section>

        <section className="flex flex-col gap-(--stack-gap)">
          <SectionHeader
            title="What you'd earn"
            description="Examples only. You choose your prices and call lengths."
          />
          <Card className="gap-0 py-0">
            <ul className="divide-y">
              {EXAMPLE_PRICES_CENTS.map((price) => (
                <li
                  key={price}
                  className="flex items-center justify-between gap-3 px-(--card-pad) py-(--inset-pad)"
                >
                  <span className="text-(length:--text-body)">
                    A {formatPrice(price)} call
                  </span>
                  <span className="text-(length:--text-body) font-bold">
                    You keep{" "}
                    {formatPrice(
                      creatorTakeHomeCents(price, creatorSharePercent),
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground border-t px-(--card-pad) py-(--inset-pad) text-(length:--text-meta)">
              After your half of Stripe's card fee. Ten {formatPrice(1000)}{" "}
              calls in an evening is{" "}
              {formatPrice(
                creatorTakeHomeCents(1000, creatorSharePercent) * 10,
              )}{" "}
              for you.
            </p>
          </Card>
        </section>

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
