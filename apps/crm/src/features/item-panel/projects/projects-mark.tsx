/** KitStak Projects app mark (brand pack `kitstak-icon-projects.svg`): three staggered bars. */
export function ProjectsMark({
  size = 16,
  className,
}: {
  readonly size?: number;
  readonly className?: string;
}) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="30 44 140 112" className={className}>
      <rect x="38" y="52" width="80" height="26" fill="#C8102E" />
      <rect x="68" y="87" width="80" height="26" fill="#D65A6E" />
      <rect x="98" y="122" width="64" height="26" fill="#C8102E" />
    </svg>
  );
}
