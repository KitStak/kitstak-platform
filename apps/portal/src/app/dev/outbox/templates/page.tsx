import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { EMAIL_TEMPLATE_IDS, type EmailTemplateId } from '@kitstak/billing/email-types';
import { SAMPLE_EMAIL_PAYLOADS, renderEmail } from '@kitstak/billing/emails';
import { Card, cn } from '@/components/ui';
import { EmailPreview } from '../_components/email-preview';
import { codeIn, templateLabel } from '../_components/words';

export const metadata: Metadata = { title: 'Email templates' };

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isTemplate(value: string | undefined): value is EmailTemplateId {
  return value !== undefined && (EMAIL_TEMPLATE_IDS as readonly string[]).includes(value);
}

/**
 * Every email KitStak sends, rendered with a sample payload. For reading the copy and checking the
 * look in light and dark without having to trigger each email by hand. Nothing is sent or stored.
 */
export default async function TemplatesPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const wanted = first(params.t);
  const template: EmailTemplateId = isTemplate(wanted) ? wanted : 'welcome';
  const email = renderEmail(template, SAMPLE_EMAIL_PAYLOADS[template]);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <Link
          href="/dev/outbox"
          className="inline-flex min-h-9 pointer-coarse:min-h-11 items-center gap-1.5 rounded-md text-sm font-medium text-fg-secondary hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Email outbox
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-fg">Email templates</h1>
        <p className="mt-1.5 max-w-2xl text-md text-fg-secondary">
          All {EMAIL_TEMPLATE_IDS.length} emails KitStak sends, with sample data. Nothing here is sent or saved.
        </p>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* min-w-0: a grid item is as wide as its content by default, which would push the page sideways. */}
        <nav aria-label="Email templates" className="min-w-0">
          <ul className="flex gap-1 overflow-x-auto pb-1 [scrollbar-width:none] lg:flex-col lg:overflow-visible lg:pb-0">
            {EMAIL_TEMPLATE_IDS.map((id) => {
              const active = id === template;
              return (
                <li key={id} className="shrink-0">
                  <Link
                    href={`/dev/outbox/templates?t=${id}`}
                    scroll={false}
                    aria-current={active ? 'page' : undefined}
                    data-testid={`template-${id}`}
                    className={cn(
                      'flex min-h-11 items-center rounded-md px-3 text-sm font-medium whitespace-nowrap',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                      active ? 'bg-selected text-fg' : 'text-fg-secondary hover:bg-hover hover:text-fg',
                    )}
                  >
                    {templateLabel(id)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <Card as="div" className="min-w-0 p-4 sm:p-6">
          <p className="text-2xs font-semibold tracking-[0.08em] text-fg-muted uppercase">Subject</p>
          <h2 data-testid="outbox-subject" className="mt-1 text-lg font-semibold tracking-[-0.01em] break-words text-fg">
            {email.subject}
          </h2>
          <div className="mt-5">
            <EmailPreview key={template} html={email.html} text={email.text} code={codeIn(template, email.text)} />
          </div>
        </Card>
      </div>
    </div>
  );
}
