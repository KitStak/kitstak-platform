/**
 * Original spot illustrations for the item panel's empty states, drawn with tokens so they
 * adapt to light and dark. Decorative (aria-hidden); the EmptyState carries the message.
 */
const P = 'var(--primary)';
const PS = 'var(--primary-selected)';
const PANEL = 'var(--surface-panel)';
const LINE = 'var(--border-default)';
const MUTED = 'var(--surface-muted)';

function Frame({ children, size }: { readonly children: React.ReactNode; readonly size: number }) {
  return (
    <svg aria-hidden viewBox="0 0 160 128" width={size} height={(size * 128) / 160} fill="none" className="animate-fade-in">
      <ellipse cx="80" cy="117" rx="56" ry="6" fill="var(--surface-sunken)" />
      {children}
    </svg>
  );
}

/** Two speech bubbles, one with a pencil: "write the first update". */
export function UpdatesArt({ size = 152 }: { readonly size?: number }) {
  return (
    <Frame size={size}>
      <rect x="20" y="22" width="88" height="54" rx="12" fill={PANEL} stroke={LINE} strokeWidth="1.5" />
      <path d="M38 76l-6 14 18-14" fill={PANEL} stroke={LINE} strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="36" cy="40" r="7" fill="var(--label-purple)" />
      <rect x="48" y="35" width="44" height="6" rx="3" fill={LINE} />
      <rect x="32" y="52" width="62" height="6" rx="3" fill={MUTED} />
      <rect x="32" y="62" width="40" height="6" rx="3" fill={MUTED} />
      <rect x="70" y="58" width="72" height="42" rx="11" fill={PS} />
      <path d="M128 100l8 10-20-10" fill={PS} />
      <rect x="82" y="70" width="40" height="6" rx="3" fill={P} opacity="0.55" />
      <rect x="82" y="82" width="26" height="6" rx="3" fill={P} opacity="0.35" />
      <g transform="rotate(-38 132 40)">
        <rect x="124" y="20" width="12" height="40" rx="3" fill="var(--label-orange)" />
        <rect x="124" y="20" width="12" height="8" rx="3" fill="var(--label-red)" />
        <path d="M124 60h12l-6 10z" fill="var(--label-peach)" />
        <path d="M128.5 66.5h3l-1.5 3.5z" fill="var(--text-primary)" />
      </g>
    </Frame>
  );
}

/** A folder with documents fanning out: "drop files here". */
export function FilesArt({ size = 152 }: { readonly size?: number }) {
  return (
    <Frame size={size}>
      <rect x="44" y="18" width="44" height="56" rx="6" fill={PANEL} stroke={LINE} strokeWidth="1.5" transform="rotate(-10 66 46)" />
      <rect x="72" y="16" width="44" height="56" rx="6" fill={PANEL} stroke={LINE} strokeWidth="1.5" transform="rotate(9 94 44)" />
      <rect x="80" y="28" width="22" height="16" rx="3" fill="var(--label-sky)" transform="rotate(9 94 44)" />
      <rect x="52" y="32" width="24" height="5" rx="2.5" fill="var(--label-red)" transform="rotate(-10 66 46)" />
      <rect x="52" y="42" width="20" height="4" rx="2" fill={MUTED} transform="rotate(-10 66 46)" />
      <path d="M28 56a6 6 0 0 1 6-6h26l8 8h58a6 6 0 0 1 6 6v38a6 6 0 0 1-6 6H34a6 6 0 0 1-6-6z" fill={PS} />
      <path d="M28 68a6 6 0 0 1 6-6h92a6 6 0 0 1 6 6v34a6 6 0 0 1-6 6H34a6 6 0 0 1-6-6z" fill={P} opacity="0.9" />
      <path d="M80 98V76m0 0l-8 8m8-8l8 8" stroke="var(--primary-fg)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </Frame>
  );
}

/** A timeline with a clock: "nothing has happened yet". */
export function ActivityArt({ size = 132 }: { readonly size?: number }) {
  return (
    <Frame size={size}>
      <path d="M44 20v86" stroke={LINE} strokeWidth="2" strokeDasharray="3 5" />
      {[30, 58, 86].map((y, index) => (
        <g key={y}>
          <circle cx="44" cy={y} r="6" fill={index === 0 ? P : PANEL} stroke={index === 0 ? P : LINE} strokeWidth="1.5" />
          <rect x="58" y={y - 9} width={index === 1 ? 52 : 70} height="18" rx="5" fill={PANEL} stroke={LINE} strokeWidth="1.5" />
          <rect x="64" y={y - 3} width={index === 1 ? 22 : 30} height="6" rx="3" fill={index === 0 ? 'var(--label-green)' : MUTED} />
        </g>
      ))}
      <circle cx="122" cy="88" r="20" fill={PS} />
      <circle cx="122" cy="88" r="14" fill={PANEL} />
      <path d="M122 80v8l6 4" stroke={P} strokeWidth="2.5" strokeLinecap="round" />
    </Frame>
  );
}
