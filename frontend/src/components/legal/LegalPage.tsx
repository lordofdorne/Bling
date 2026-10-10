import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { PageHeader, SectionHeader } from "@/components/page";
import { ViewerShell } from "@/components/ViewerShell";
import { SITE } from "@/lib/site";

// Shared layout for the policy and contact pages: the viewer shell, one
// page header, then numbered sections in a readable column.

export function LegalPage({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <ViewerShell>
      <article className="flex max-w-prose flex-col gap-(--section-gap)">
        <PageHeader
          eyebrow="Bling policies"
          title={title}
          description={description}
        >
          <p className="text-muted-foreground text-(length:--text-meta)">
            Effective {SITE.policiesEffective}
          </p>
        </PageHeader>
        {children}
      </article>
    </ViewerShell>
  );
}

export function LegalSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-(--stack-gap)">
      <SectionHeader title={title} />
      <div className="text-(length:--text-body) flex flex-col gap-3 leading-relaxed [&_li]:ml-5 [&_li]:list-disc [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-2">
        {children}
      </div>
    </section>
  );
}

export function SupportEmail() {
  return (
    <a
      className="text-primary font-semibold underline-offset-4 hover:underline"
      href={`mailto:${SITE.supportEmail}`}
    >
      {SITE.supportEmail}
    </a>
  );
}

export function PolicyLink({
  to,
  children,
}: {
  to: string;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className="text-primary font-semibold underline-offset-4 hover:underline"
    >
      {children}
    </Link>
  );
}
