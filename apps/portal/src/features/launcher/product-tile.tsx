import Link from 'next/link';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { AppIcon } from '@kitstak/ui/app-icon';
import type { Module } from '@kitstak/entitlements';
import { PLAN_BADGE_LABELS, type PlanBadge } from '@kitstak/billing/plan-state';
import type { TileStat } from '@/server/product-stats';
import { Badge, cn } from '@/components/ui';

export interface ProductTileProps {
  readonly module: Module;
  readonly name: string;
  readonly tagline: string;
  readonly href: string;
  /** Whether the tile opens the app: full access, view only, or the dev switch. */
  readonly entitled: boolean;
  /** The plan badge, the same one the app switcher and billing home show. */
  readonly badge: PlanBadge;
  /** One plain line about the plan state of this app ("9 days left in your free trial"). */
  readonly planNote?: string | null;
  /** For an app that is not in the plan: the button words and where it goes. null: the viewer cannot add it. */
  readonly addAction?: { readonly label: string; readonly href: string } | null;
  /** Live numbers from the shared db (null: stats unavailable, render nothing). */
  readonly stats?: readonly TileStat[] | null;
  /** Deep link for the empty-state CTA cell (e.g. the CRM pipeline). */
  readonly emptyStateHref?: string;
  /** Extra grid classes from the launcher (e.g. span a full row). */
  readonly className?: string;
}

const BADGE_TONE: Readonly<Record<PlanBadge, 'success' | 'info' | 'warning' | 'danger' | 'neutral'>> = {
  trial: 'info',
  active: 'success',
  past_due: 'warning',
  view_only: 'danger',
  not_in_plan: 'neutral',
  included: 'success',
};

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

/** One launcher tile: the app, its plan badge, live numbers, and the one thing to do next. */
export function ProductTile({
  module,
  name,
  tagline,
  href,
  entitled,
  badge,
  planNote,
  addAction,
  stats,
  emptyStateHref,
  className,
}: ProductTileProps) {
  const shortName = name.replace('KitStak ', '');
  const noteTone = badge === 'past_due' ? 'text-warning-text font-medium' : badge === 'view_only' ? 'text-danger-text font-medium' : 'text-fg-muted';
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
        <span data-testid={`tile-badge-${module}`}>
          <Badge tone={BADGE_TONE[badge]}>{PLAN_BADGE_LABELS[badge]}</Badge>
        </span>
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
      <div className="mt-5 flex items-center justify-between gap-3 border-t border-border-subtle pt-4">
        <span className={cn('min-w-0 text-xs', noteTone)}>{planNote ?? (entitled ? 'Opens in a new tab' : 'Not in your plan')}</span>
        <span
          data-testid={`tile-action-${module}`}
          className={cn(
            'inline-flex shrink-0 items-center gap-1 text-sm font-semibold',
            entitled || addAction ? 'text-fg group-hover:underline' : 'text-fg-muted',
          )}
        >
          {entitled ? (
            <>
              Open {shortName}
              <ArrowUpRight
                aria-hidden
                className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 motion-reduce:transition-none"
              />
            </>
          ) : addAction ? (
            <>
              {addAction.label}
              <ArrowRight aria-hidden className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
            </>
          ) : (
            'See Billing'
          )}
        </span>
      </div>
    </>
  );

  const tileClass = cn(
    'group relative flex flex-col rounded-2xl border bg-panel p-6 text-left',
    'transition-[box-shadow,border-color,transform] duration-[var(--duration-fast)] ease-out motion-reduce:transition-none',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
    entitled
      ? 'border-border-default shadow-xs hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md motion-reduce:hover:translate-y-0'
      : 'border-border-subtle bg-muted/60 hover:border-border-default',
    className,
  );

  if (entitled) {
    // Stretched-link pattern: the overlay anchor opens the product, so the empty-state
    // CTA can be its own (non-nested) link layered above it via `relative`.
    return (
      <div data-testid={`tile-${module}`} className={tileClass}>
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
    <Link data-testid={`tile-${module}`} href={addAction?.href ?? '/billing'} className={tileClass}>
      {body}
    </Link>
  );
}
