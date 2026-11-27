import { notFound } from 'next/navigation';
import { addDays, formatQty, parseRunId, unitLabel } from '@kitstak/programs-engine';
import { getProgramDetail, listBuilds, listVariants } from '@/server/domain/programs';
import { isDomainError } from '@/server/errors';
import { pageContext } from '@/server/page';
import type { BuildDTO } from '@/lib/program-types';
import { dayLabel, rangeLabel } from '../kit/format';
import { TicketsChrome } from './tickets-chrome';
import { TicketBarcode } from './ticket-barcode';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Build tickets (docs/programs/SPEC.md 5.20): one ticket per build with the program, the build key
 * as a Code 128 barcode, the variant, SKU, planned qty and day. A print layout over the app (the
 * shell and the program header are hidden when printing).
 */
export async function BuildTicketsPage({ programKey, run, from, to }: { readonly programKey: string; readonly run: string | null; readonly from: string | null; readonly to: string | null }) {
  const { ctx } = await pageContext(`/programs/${programKey}/tickets`);
  const program = await getProgramDetail(ctx, programKey).catch((error: unknown) => {
    if (isDomainError(error) && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) notFound();
    throw error;
  });
  const parsedRun = run ? parseRunId(run) : null;
  const today = program.calendar.today;
  const start = parsedRun?.date ?? (from && ISO.test(from) ? from : today);
  const end = parsedRun?.date ?? (to && ISO.test(to) && to >= start ? to : start);
  const capped = end > addDays(start, 62) ? addDays(start, 62) : end;
  const [page, variants] = await Promise.all([listBuilds(ctx, programKey, { from: start, to: capped, ...(run ? { runId: run } : {}), limit: 500 }), listVariants(ctx, programKey, { includeRetired: true })]);
  const builds = (page.items as readonly BuildDTO[]).filter((build) => build.statusCategory !== 'cancelled' && (!run || build.build.runId === run)).sort((a, b) => a.build.buildDate.localeCompare(b.build.buildDate) || a.number - b.number);
  const title = run ? `${program.name} · ${dayLabel(start)} run` : `${program.name} · ${rangeLabel(start, capped)}`;
  const skuOf = new Map(variants.filter((variant) => variant.sku).map((variant) => [variant.id, variant.sku as string]));
  return (
    <TicketsChrome title={title} count={builds.length} backHref={`/programs/${encodeURIComponent(program.key)}/builds/runs?range=${start === capped ? start : `${start}..${capped}`}`}>
      {builds.length === 0 ? (
        <p className="col-span-full py-16 text-center text-sm text-fg-muted">No open builds on these days.</p>
      ) : (
        builds.map((build) => (
          <article key={build.id} className="ticket flex break-inside-avoid flex-col gap-3 rounded-lg border border-border-default bg-panel p-4 text-fg print:rounded-none print:border-black print:bg-white print:text-black" data-testid="build-ticket">
            <header className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-2xs font-semibold tracking-wide text-fg-muted uppercase print:text-black">{program.name}</p>
                <p className="truncate text-lg font-semibold">{build.build.variantName ?? build.title}</p>
              </div>
              <span className="shrink-0 rounded-md border border-border-default px-2 py-1 text-right print:border-black">
                <span className="block text-2xs text-fg-muted print:text-black">Day</span>
                <span className="block text-sm font-semibold">{dayLabel(build.build.buildDate)}</span>
              </span>
            </header>
            <TicketBarcode value={build.key} />
            <dl className="grid grid-cols-3 gap-2 text-sm">
              <div>
                <dt className="text-2xs text-fg-muted print:text-black">Build</dt>
                <dd className="font-key font-semibold">{build.key}</dd>
              </div>
              <div>
                <dt className="text-2xs text-fg-muted print:text-black">SKU</dt>
                <dd className="truncate font-key">{skuOf.get(build.build.variantId ?? '') ?? 'No SKU'}</dd>
              </div>
              <div>
                <dt className="text-2xs text-fg-muted print:text-black">Planned</dt>
                <dd className="font-semibold tabular-nums">{unitLabel(build.build.plannedQty, program.unit)}</dd>
              </div>
            </dl>
            <div className="mt-auto grid grid-cols-2 gap-3 border-t border-dashed border-border-default pt-2 text-2xs text-fg-muted print:border-black print:text-black">
              <span>Built ______ of {formatQty(build.build.plannedQty)}</span>
              <span>Checked by ____________</span>
            </div>
          </article>
        ))
      )}
    </TicketsChrome>
  );
}
