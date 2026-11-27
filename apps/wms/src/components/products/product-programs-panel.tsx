'use client';

/**
 * "Programs" panel in a kit product's Components tab (docs/programs/SPEC.md 6.3): the KitStak
 * Projects programs that build this kit, with the variant, how many are planned this week, how
 * many were built this month and the next build date. Read only and units only: planned builds
 * never reserve stock and never make work orders. Hidden when Projects is not available to this
 * workspace or person. While loading it shows skeleton rows, and a failed request says so with a
 * retry, so an error never looks like "no programs".
 */
import * as React from 'react';
import { AlertCircle, ArrowUpRight, Repeat2, RotateCw } from 'lucide-react';
import { formatQty } from '@kitstak/programs-engine/format';
import type { KitProgram } from '@kitstak/pm-bridge/programs';
import { useApiQuery } from '@/lib/query-client';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useFormat } from '@/lib/format';
import type { ProductProgramsDto } from '@/server/projects/bridge';
import { Section, MiniTable } from './product-detail-sections';

const EXTERNAL = { target: '_blank', rel: 'noopener noreferrer' } as const;
const TITLE = 'Programs';
const DESCRIPTION = 'These programs build this kit in KitStak Projects. Planned builds do not reserve stock.';

function LoadingRows() {
  return (
    <div role="status" aria-label="Loading programs" className="flex flex-col divide-y divide-border" data-testid="product-programs-loading">
      {[0, 1].map((row) => (
        <div key={row} className="flex items-center gap-4 px-5 py-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-24" />
          <span className="flex-1" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </div>
  );
}

function LoadError({ onRetry, retrying }: { readonly onRetry: () => void; readonly retrying: boolean }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 px-5 py-4" data-testid="product-programs-error">
      <AlertCircle aria-hidden className="size-4 shrink-0 text-danger" />
      <p className="min-w-0 flex-1 text-sm text-fg-secondary">Couldn’t load programs from KitStak Projects. Your stock is not affected.</p>
      <Button size="sm" variant="secondary" onClick={onRetry} disabled={retrying}>
        <RotateCw aria-hidden className={retrying ? 'size-3.5 animate-spin' : 'size-3.5'} />
        {retrying ? 'Trying again' : 'Try again'}
      </Button>
    </div>
  );
}

function units(qty: string, unit: KitProgram['unit']): string {
  return `${formatQty(qty)} ${qty === '1.000' ? unit.singular : unit.plural}`;
}

export function ProductProgramsPanel({ productId }: { readonly productId: string }) {
  const format = useFormat();
  const query = useApiQuery<ProductProgramsDto>(['product-programs', productId], `/api/products/${encodeURIComponent(productId)}/programs`, {
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const data = query.data?.data;
  if (query.isPending) {
    return (
      <Section title={TITLE} description={DESCRIPTION}>
        <LoadingRows />
      </Section>
    );
  }
  if (query.isError || !data) {
    return (
      <Section title={TITLE} description={DESCRIPTION}>
        <LoadError onRetry={() => void query.refetch()} retrying={query.isFetching} />
      </Section>
    );
  }
  if (!data.available) return null;
  return (
    <Section
      title={TITLE}
      description={DESCRIPTION}
      action={
        <a
          href={`${data.projectsUrl}/programs`}
          {...EXTERNAL}
          className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          All programs
          <ArrowUpRight aria-hidden className="size-3.5" />
          <span className="sr-only"> (opens KitStak Projects in a new tab)</span>
        </a>
      }
    >
      <div data-testid="product-programs">
        <MiniTable
          rows={data.programs}
          getKey={(row) => `${row.key}:${row.variant.id}`}
          empty={{
            title: 'No programs build this kit',
            description: 'When a program in KitStak Projects links one of its variants to this kit, it shows here.',
          }}
          columns={[
            {
              key: 'program',
              label: 'Program',
              render: (row) => (
                <a
                  href={row.url}
                  {...EXTERNAL}
                  className="inline-flex min-w-0 items-center gap-2 font-semibold text-primary hover:underline"
                  title={`${row.key} · ${row.name}`}
                >
                  <Repeat2 aria-hidden className="size-3.5 shrink-0" />
                  <span className="font-mono text-xs">{row.key}</span>
                  <span className="truncate font-medium text-foreground">{row.name}</span>
                  <span className="sr-only"> (opens KitStak Projects in a new tab)</span>
                </a>
              ),
            },
            {
              key: 'variant',
              label: 'Variant',
              render: (row) => (
                <span className="block min-w-0">
                  <span className="block truncate">{row.variant.name}</span>
                  {row.variant.sku ? <span className="block truncate font-mono text-2xs text-secondary">{row.variant.sku}</span> : null}
                </span>
              ),
            },
            {
              key: 'week',
              label: 'Planned this week',
              align: 'right',
              render: (row) => <span className="tabular-nums">{units(row.plannedThisWeek, row.unit)}</span>,
            },
            {
              key: 'month',
              label: 'Built this month',
              align: 'right',
              render: (row) => <span className="font-semibold tabular-nums">{units(row.builtThisMonth, row.unit)}</span>,
            },
            {
              key: 'next',
              label: 'Next build',
              align: 'right',
              render: (row) =>
                row.nextBuildDate ? (
                  <span className="tabular-nums">{format.date(row.nextBuildDate)}</span>
                ) : (
                  <span className="text-secondary">None planned</span>
                ),
            },
          ]}
        />
      </div>
    </Section>
  );
}
