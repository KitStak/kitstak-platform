/**
 * KitStak Pulse app mark, shape for shape from the official brand file (`kitstak-icon-pulse.svg`):
 * two notched bars, red over pink. The view box crops the file's padding to 8 units a side.
 */
export function PulseMark({ size = 16, className }: { readonly size?: number; readonly className?: string }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="32 45 136 110" className={className}>
      <polygon points="40,71 82,71 100,53 118,71 160,71 160,101 118,101 100,83 82,101 40,101" fill="#C8102E" />
      <polygon points="40,117 82,117 100,99 118,117 160,117 160,147 118,147 100,129 82,147 40,147" fill="#D65A6E" />
    </svg>
  );
}
