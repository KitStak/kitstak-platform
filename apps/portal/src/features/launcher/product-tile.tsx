import Link from 'next/link';
import { ArrowUpRight, Lock } from 'lucide-react';
import { AppIcon } from '@kitstak/ui/app-icon';
import type { Module } from '@kitstak/entitlements';
import type { ModuleAccess } from '@/server/entitlements';
import type { TileStat } from '@/server/product-stats';
import { Badge, cn } from '@/components/ui';

export interface ProductTileProps {
  readonly module: Module;
  readonly name: string;
  readonly tagline: string;
  readonly href: string;
  readonly entitled: boolean;
  readonly access: ModuleAccess;
  readonly periodEnd: Date | null;
  /** Live numbers from the shared db (null: stats unavailable, render nothing). */
  readonly stats?: readonly TileStat[] | null;
  /** Deep link for the empty-state CTA cell (e.g. the CRM pipeline). */
  readonly emptyStateHref?: string;
  /** Extra grid classes from the launcher (e.g. span a full row). */
  readonly className?: string;
}

const ACCESS_BADGE: Readonly<
  Record<ModuleAccess, { label: string; tone: 'success' | 'info' | 'warning' | 'neutral' }>
> = {
  active: { label: 'Active', tone: 'success' },
  trial: { label: 'Trial', tone: 'info' },
  grace: { label: 'Payment past due', tone: 'warning' },
  dev: { label: 'Dev access', tone: 'info' },
  locked: { label: 'Locked', tone: 'neutral' },
};

const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** Shown in place of the stat grid when every stat is zero: '0 / 0' reads like a bug. */
interface EmptyStateCopy {
  readonly message: string;
  readonly cta: string;
}

const EMPTY_STATS_COPY: Readonly<Record<Module, EmptyStateCopy>> = {
  crm: { message: 'No deals yet', cta: 'Create your first deal' },
  wms: { message: 'No open orders', cta: 'Create your first order' },
  projects: { message: 'No projects yet', cta: 'Start your first project' },
  pulse: { message: 'No jobs yet', cta: 'Add your first job' },
};

/** Matches the stat-cell geometry (text-lg value line + text-xs label line) so both tiles stay equal height. */
const EMPTY_CELL_CLASS = 'flex flex-col rounded-lg bg-sunken px-3 py-2';

/** Two-cell empty state with the same footprint as the stat grid. */
function EmptyStats({ module, ctaHref }: { readonly module: Module; readonly ctaHref?: string }) {
  const copy = EMPTY_STATS_COPY[module];
  const cta = (
    <>
      <span aria-hidden className="text-lg font-semibold text-fg-muted transition-transform group-hover/cta:translate-x-0.5">
        &rarr;
      </span>
      <span className="text-xs text-fg-muted group-hover/cta:text-fg-secondary">{copy.cta}</span>
    </>
  );
  return (
    <div className="mt-5 grid grid-cols-2 gap-2">
      <p className={EMPTY_CELL_CLASS}>
        <span aria-hidden className="text-lg font-semibold text-fg-muted tabular-nums">
          0
        </span>
        <span className="text-xs text-fg-muted">{copy.message}</span>
      </p>
      {ctaHref ? (
        <a
          href={ctaHref}
          target="_blank"
          rel="noopener"
          className={cn(
            EMPTY_CELL_CLASS,
            'group/cta relative transition-colors duration-[var(--duration-fast)] hover:bg-muted',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
          )}
        >
          {cta}
        </a>
      ) : (
        <p className={EMPTY_CELL_CLASS}>{cta}</p>
      )}
    </div>
  );
}

/** One launcher tile: product identity, entitlement state, and the Open / unlock action. */
export function ProductTile({
  module,
  name,
  tagline,
  href,
  entitled,
  access,
  periodEnd,
  stats,
  emptyStateHref,
  className,
}: ProductTileProps) {
  const badge = ACCESS_BADGE[access];
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span
          className={cn(
            'inline-flex size-12 items-center justify-center rounded-lg bg-sunken',
            !entitled && 'opacity-55 grayscale',
          )}
        >
          <AppIcon app={module} size={44} />
        </span>
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </div>
      <div className="mt-5 grow">
        <h2 className="text-lg font-semibold text-fg">{name}</h2>
        <p className="mt-0.5 text-sm font-medium text-fg-secondary">{tagline}</p>
      </div>
      {entitled && stats && stats.length > 0 ? (
        stats.every((stat) => stat.value === 0 && stat.display === undefined) ? (
          <EmptyStats module={module} ctaHref={emptyStateHref} />
        ) : (
          <dl className={cn('mt-5 grid gap-2', stats.length >= 3 ? 'grid-cols-3' : 'grid-cols-2')}>
            {stats.map((stat) => (
              <div key={stat.label} className="flex flex-col rounded-lg bg-sunken px-3 py-2">
                <dd
                  className={cn(
                    'order-1 text-lg font-semibold tabular-nums',
                    stat.tone === 'danger' ? 'text-danger-text' : stat.tone === 'warning' ? 'text-warning-text' : 'text-fg',
                  )}
                >
                  {stat.display ?? stat.value}
                </dd>
                <dt className="order-2 text-xs text-fg-muted">{stat.label}</dt>
              </div>
            ))}
          </dl>
        )
      ) : null}
      <div className="mt-5 flex items-center justify-between border-t border-border-subtle pt-4">
        {access === 'grace' && periodEnd ? (
          <span className="text-xs font-medium text-warning-text">
            Access ends soon. Period ended {dateFormat.format(periodEnd)}
          </span>
        ) : access === 'locked' ? (
          <span className="text-xs text-fg-muted">Not included in your plan</span>
        ) : (
          <span className="text-xs text-fg-muted">Opens in a new tab</span>
        )}
        <span
          className={cn(
            'inline-flex items-center gap-1 text-sm font-semibold',
            entitled ? 'text-fg group-hover:underline' : 'text-fg-muted',
          )}
        >
          {entitled ? (
            <>
              Open {name.replace('KitStak ', '')}
              <ArrowUpRight
                aria-hidden
                className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              />
            </>
          ) : (
            <>
              <Lock aria-hidden className="size-3.5" />
              View plans
            </>
          )}
        </span>
      </div>
    </>
  );

  const tileClass = cn(
    'group relative flex flex-col rounded-2xl border bg-panel p-6 text-left',
    'transition-[box-shadow,border-color,transform] duration-[var(--duration-fast)] ease-out',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
    entitled
      ? 'border-border-default shadow-xs hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md'
      : 'border-border-subtle bg-muted/60 hover:border-border-default',
    className,
  );

  if (entitled) {
    // Stretched-link pattern: the overlay anchor opens the product, so the empty-state
    // CTA can be its own (non-nested) link layered above it via `relative`.
    return (
      <div className={tileClass}>
        <a
          href={href}
          target="_blank"
          rel="noopener"
          aria-label={`Open ${name}`}
          className="absolute inset-0 rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        />
        {body}
      </div>
    );
  }
  return (
    <Link href={`/billing/upgrade?module=${module}`} className={tileClass}>
      {body}
    </Link>
  );
}
