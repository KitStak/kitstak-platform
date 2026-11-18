/**
 * KitStak Pulse app mark, rect for rect from the official brand file (`kitstak-icon-pulse.svg`):
 * a full bar over a meter with a faded track.
 */
export function PulseMark({ size = 16, className }: { readonly size?: number; readonly className?: string }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="32 44 136 112" className={className}>
      <rect x="40" y="62" width="120" height="30" fill="#C8102E" />
      <rect x="40" y="108" width="120" height="30" fill="#D65A6E" opacity="0.35" />
      <rect x="40" y="108" width="84" height="30" fill="#D65A6E" />
    </svg>
  );
}
