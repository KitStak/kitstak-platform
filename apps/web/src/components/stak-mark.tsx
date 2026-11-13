/**
 * The KitStak mark (two stacked bars, 5:1, gap half a bar) used as the product glyph across the
 * site: the top bar is the CRM, the bottom bar is the WMS, and both lit is the full stack.
 */
export type StakMarkLit = 'crm' | 'wms' | 'both' | 'none';

interface StakMarkProps {
  readonly lit?: StakMarkLit;
  /** Width in px; height is half of it. */
  readonly size?: number;
  readonly className?: string;
}

const DIM = 0.22;

export function StakMark({ lit = 'both', size = 28, className }: StakMarkProps) {
  const top = lit === 'both' || lit === 'crm';
  const bottom = lit === 'both' || lit === 'wms';
  return (
    <svg aria-hidden viewBox="0 0 10 5" width={size} height={size / 2} className={className} style={{ flex: 'none' }}>
      <rect x="0" y="0" width="10" height="2" fill={top ? 'var(--brand-red)' : 'currentColor'} opacity={top ? 1 : DIM} />
      <rect
        x="0"
        y="3"
        width="10"
        height="2"
        fill={bottom ? 'var(--stak-lower, var(--brand-oxblood))' : 'currentColor'}
        opacity={bottom ? 1 : DIM}
      />
    </svg>
  );
}
