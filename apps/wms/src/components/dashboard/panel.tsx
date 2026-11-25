'use client';

/**
 * The dashboard card: the shared `DashSection` (docs/design/UI-CLEANUP.md) plus the WMS freshness
 * stamp. Cards speak about freshness only when they are refreshing or stale; the routine
 * "Updated hh:mm" lives once in the page header.
 */
import * as React from 'react';
import { DashSection, Pill, type DashAction } from '@kitstak/ui/dashboard';

const nf = new Intl.NumberFormat('en-US');
export const fmt = (n: number): string => nf.format(n);
export const pctOf = (done: number, total: number): number => (total > 0 ? Math.round((done / total) * 100) : 0);

/** Row hover and focus for links inside a card: neutral, never the crimson brand tint. */
export const ROW_LINK =
  'rounded-md hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus';

/** When the data behind every card was computed, and whether a refresh is in flight. */
export interface PanelFreshness {
  /** Server compute time of the payload (ISO). */
  readonly asOf: string | null;
  readonly refreshing: boolean;
  /** Auto refresh interval; data older than twice this reads as stale. */
  readonly intervalMs: number;
  /** Client clock, re-read every 30 s so the age stays current between refreshes. */
  readonly now: number | null;
}

export const PanelFreshnessContext = React.createContext<PanelFreshness | null>(null);

/** "Updated 2:41 PM" / "Updated 2:41 PM · 4 min ago (stale)"; null before mount. */
export function freshnessLabel(
  f: Pick<PanelFreshness, 'asOf' | 'intervalMs' | 'now'>,
): { readonly text: string; readonly stale: boolean } | null {
  if (!f.asOf || f.now === null) return null;
  const at = Date.parse(f.asOf);
  if (!Number.isFinite(at)) return null;
  const time = new Date(at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const ageMin = Math.max(0, Math.floor((f.now - at) / 60_000));
  const stale = f.now - at > 2 * f.intervalMs;
  return { text: stale ? `Updated ${time} · ${ageMin} min ago` : `Updated ${time}`, stale };
}

/** The card's own freshness note, or null when the header stamp already says it all. */
function usePanelStamp(): React.ReactNode {
  const f = React.useContext(PanelFreshnessContext);
  if (!f) return null;
  const label = freshnessLabel(f);
  if (f.refreshing) {
    return (
      <span data-testid="panel-updated" className="mt-0.5 block tabular-nums">
        Refreshing…
      </span>
    );
  }
  if (!label?.stale) return null;
  return (
    <span data-testid="panel-updated" data-stale="true" className="mt-1 block">
      <Pill tone="caution">{label.text}</Pill>
    </span>
  );
}

export interface PanelProps {
  readonly title: string;
  readonly description?: string;
  /** The one header link ("All open jobs"). */
  readonly action?: DashAction;
  /** A small control in the header (tabs), left of the action. */
  readonly aside?: React.ReactNode;
  readonly footer?: React.ReactNode;
  readonly flush?: boolean;
  readonly children: React.ReactNode;
  readonly className?: string;
  readonly 'data-testid'?: string;
}

export function Panel({ title, description, action, aside, footer, flush, children, className, ...rest }: PanelProps) {
  const stamp = usePanelStamp();
  return (
    <DashSection
      title={title}
      description={
        description || stamp ? (
          <>
            {description}
            {stamp}
          </>
        ) : undefined
      }
      action={action}
      aside={aside}
      footer={footer}
      flush={flush}
      className={className}
      data-testid={rest['data-testid']}
    >
      {children}
    </DashSection>
  );
}
