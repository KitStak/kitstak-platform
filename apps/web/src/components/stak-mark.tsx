/**
 * The KitStak mark (two stacked bars, 5:1, gap half a bar) used as the product glyph across the
 * site: the top bar is the CRM, the bottom bar is the WMS, and both lit is the full stack.
 * `projects` draws a third bar under the mark, in the surrounding ink, for the product that is
 * being added to the stack. The supplied logo artwork itself is never redrawn.
 */
export type StakMarkLit = 'crm' | 'wms' | 'both' | 'none' | 'projects';

interface StakMarkProps {
  readonly lit?: StakMarkLit;
  /** Width in px; height follows the mark's proportions. */
  readonly size?: number;
  readonly className?: string;
}

const DIM = 0.22;

export function StakMark({ lit = 'both', size = 28, className }: StakMarkProps) {
  const top = lit === 'both' || lit === 'crm';
  const bottom = lit === 'both' || lit === 'wms';
  const hasThird = lit === 'projects';
  const height = hasThird ? 8 : 5;
  return (
    <svg
      aria-hidden
      viewBox={`0 0 10 ${height}`}
      width={size}
      height={(size * height) / 10}
      className={className}
      style={{ flex: 'none' }}
    >
      <rect x="0" y="0" width="10" height="2" fill={top ? 'var(--brand-red)' : 'currentColor'} opacity={top ? 1 : DIM} />
      <rect
        x="0"
        y="3"
        width="10"
        height="2"
        fill={bottom ? 'var(--stak-lower, var(--brand-oxblood))' : 'currentColor'}
        opacity={bottom ? 1 : DIM}
      />
      {hasThird ? <rect x="0" y="6" width="10" height="2" fill="currentColor" /> : null}
    </svg>
  );
}
