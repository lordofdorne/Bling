import { Link } from "react-router-dom";
import { ArrowRight, Hand, Headphones, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/page";

// The first thing a signed-out visitor sees on the home page: what Bling is,
// in one line, and how a call happens, in three steps.

const STEPS = [
  {
    Icon: Radio,
    title: "A creator goes live",
    body: "They open their Hotline for one-on-one chats or callers on their stream, and set what a call costs.",
  },
  {
    Icon: Hand,
    title: "You ask to talk",
    body: "Send your name and what you want to talk about. No account needed.",
  },
  {
    Icon: Headphones,
    title: "They pick you, you talk",
    body: "The creator chooses who to call. Paid calls charge only if you're picked.",
  },
];

export function HomeIntro() {
  return (
    <section
      aria-labelledby="home-intro-title"
      className="flex flex-col gap-(--section-gap)"
    >
      <div className="flex flex-col gap-(--stack-gap)">
        <Eyebrow>Live voice calls with creators</Eyebrow>
        <h1
          id="home-intro-title"
          className="text-(length:--text-page-title) leading-tight font-extrabold tracking-tight text-balance"
        >
          Talk live with the creators you follow.
        </h1>
        <p className="text-muted-foreground max-w-prose text-(length:--text-body) text-pretty">
          Ask to call a creator while they're live. Some talk with fans
          one-on-one; others bring callers onto their livestream for everyone to
          hear. Either way, they pick who to call, and it all happens in your
          browser.
        </p>
        <div className="flex flex-col gap-2 tablet:flex-row">
          <Button
            asChild
            variant="secondary"
            size="lg"
            className="w-full tablet:w-auto"
          >
            <Link to="/register">
              <Radio className="size-4" />
              I'm a creator
            </Link>
          </Button>
          <Button asChild size="lg" className="w-full tablet:w-auto">
            <a href="#creators">
              Find someone to call
              <ArrowRight className="size-4" />
            </a>
          </Button>
        </div>
      </div>

      <Card className="gap-0 py-0" aria-label="How Bling works">
        <ol className="flex flex-col divide-y tablet:flex-row tablet:divide-x tablet:divide-y-0">
          {STEPS.map(({ Icon, title, body }, index) => (
            <li
              key={title}
              className="flex flex-1 gap-3 p-(--card-pad) tablet:flex-col"
            >
              <span className="bg-[var(--mauve-surface)] text-primary grid size-(--icon-button) shrink-0 place-items-center rounded-lg">
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <div className="flex min-w-0 flex-col gap-1">
                <h2 className="text-(length:--text-card-title) font-bold">
                  <span className="text-muted-foreground">{index + 1}. </span>
                  {title}
                </h2>
                <p className="text-muted-foreground text-(length:--text-body)">
                  {body}
                </p>
              </div>
            </li>
          ))}
        </ol>
        <p className="text-muted-foreground border-t px-(--card-pad) py-(--inset-pad) text-(length:--text-meta)">
          New here?{" "}
          <Link
            to="/faq"
            className="text-primary font-semibold underline-offset-4 hover:underline"
          >
            Read the FAQ
          </Link>{" "}
          or{" "}
          <Link
            to="/about"
            className="text-primary font-semibold underline-offset-4 hover:underline"
          >
            learn about Bling
          </Link>
          .
        </p>
      </Card>
    </section>
  );
}
