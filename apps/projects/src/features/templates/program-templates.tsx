'use client';
/**
 * Program templates on the Templates page (docs/programs/SPEC.md 5.4 "From a template"): each one
 * shows its kits, price lines and schedule, and "Use template" opens the New program wizard on it.
 */
import Link from 'next/link';
import { ArrowRight, Repeat2 } from 'lucide-react';
import { buttonVariants } from '@/components/ui';
import { routes } from '@/lib/routes';
import type { ProgramTemplateDTO } from '@/lib/program-types';
import { ProgramIcon } from '@/features/programs/kit';

export function ProgramTemplates({ templates, canUse }: { readonly templates: readonly ProgramTemplateDTO[]; readonly canUse: boolean }) {
  if (templates.length === 0) return null;
  return (
    <section className="mt-8 flex flex-col gap-3" aria-labelledby="program-templates-title" data-testid="program-templates">
      <div>
        <h2 id="program-templates-title" className="flex items-center gap-2 text-lg font-semibold text-fg"><Repeat2 aria-hidden className="size-5 text-icon" />Program templates</h2>
        <p className="text-sm text-fg-muted">Kits, price card lines and schedules from programs you saved. Dates and output are never copied.</p>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {templates.map((template) => {
          const payload = template.payload;
          return (
            <li key={template.id} className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-panel p-4 shadow-xs">
              <div className="flex items-center gap-2.5">
                <ProgramIcon size={28} />
                <div className="min-w-0">
                  <p className="truncate font-semibold text-fg" title={template.name}>{template.name}</p>
                  <p className="truncate text-xs text-fg-muted">{template.description ?? `Counts ${payload.settings.unitPlural}`}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {payload.variants.slice(0, 6).map((variant) => <span key={variant.key} className="rounded-sm bg-sunken px-1.5 py-0.5 text-2xs text-fg-secondary">{variant.name}</span>)}
                {payload.variants.length > 6 ? <span className="px-1 text-2xs text-fg-muted">+{payload.variants.length - 6} more</span> : null}
              </div>
              <p className="text-xs text-fg-secondary">
                {payload.variants.length} {payload.variants.length === 1 ? 'kit' : 'kits'} · {payload.card ? `${payload.card.lines.length} price ${payload.card.lines.length === 1 ? 'line' : 'lines'}` : 'No price card'} · {payload.schedules.length ? `${payload.schedules.length} ${payload.schedules.length === 1 ? 'schedule' : 'schedules'}` : 'No schedule'}
              </p>
              {canUse ? (
                <Link href={routes.newProgram({ template: template.id })} className={buttonVariants({ variant: 'secondary', size: 'sm', className: 'mt-auto self-start' })}>
                  Use template
                  <ArrowRight aria-hidden className="size-4" />
                </Link>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
