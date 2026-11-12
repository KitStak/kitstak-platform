import Link from 'next/link';
import { ArrowUpRight, Lock } from 'lucide-react';
import type { Module } from '@kitstak/entitlements';
import type { ModuleAccess } from '@/server/entitlements';
import { Badge, cn } from '@/components/ui';

export interface ProductTileProps {
  readonly module: Module;
  readonly name: string;
  readonly tagline: string;
  readonly description: string;
  readonly href: string;
  readonly entitled: boolean;
  readonly access: ModuleAccess;
  readonly periodEnd: Date | null;
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

/** One launcher tile: product identity, entitlement state, and the Open / unlock action. */
export function ProductTile({
  module,
  name,
  tagline,
  description,
  href,
  entitled,
  access,
  periodEnd,
}: ProductTileProps) {
  const badge = ACCESS_BADGE[access];
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span
          className={cn(
            'inline-flex h-10 items-center rounded-lg px-3 text-sm font-bold tracking-[0.12em] uppercase',
            entitled ? 'bg-inverse text-fg-inverse' : 'bg-sunken text-fg-muted',
          )}
        >
          {module}
        </span>
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </div>
      <div className="mt-5">
        <h2 className="text-lg font-semibold text-fg">{name}</h2>
        <p className="mt-0.5 text-sm font-medium text-fg-secondary">{tagline}</p>
        <p className="mt-2 text-sm text-fg-muted">{description}</p>
      </div>
      <div className="mt-6 flex items-center justify-between border-t border-border-subtle pt-4">
        {access === 'grace' && periodEnd ? (
          <span className="text-xs font-medium text-warning-text">
            Access ends soon — period ended {dateFormat.format(periodEnd)}
          </span>
        ) : access === 'dev' ? (
          <span className="text-xs text-fg-muted">ENTITLEMENTS_DEV_ALLOW_ALL</span>
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
              View billing
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
  );

  if (entitled) {
    return (
      <a href={href} target="_blank" rel="noopener" className={tileClass}>
        {body}
      </a>
    );
  }
  return (
    <Link href={`/billing?module=${module}`} className={tileClass}>
      {body}
    </Link>
  );
}
