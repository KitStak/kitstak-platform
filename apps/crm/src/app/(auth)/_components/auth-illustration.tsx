/**
 * Original hero artwork for the auth pages: a floating KitStak board card with status pills,
 * a pipeline bar chart and avatar chips on a layered brand backdrop. Pure SVG, no assets.
 */
export function AuthIllustration() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 520 440"
      className="h-auto w-full max-w-[520px] drop-shadow-[0_30px_60px_rgba(3,7,14,0.5)]"
    >
      <defs>
        <linearGradient id="auth-card" x1="0" y1="0" x2="0" y2="1">
          <stop className="auth-card-a" offset="0" stopColor="#ffffff" />
          <stop className="auth-card-b" offset="1" stopColor="#f8f6f0" />
        </linearGradient>
        <linearGradient id="auth-bar" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#8f122c" />
          <stop offset="1" stopColor="#c8102e" />
        </linearGradient>
      </defs>

      {/* Back card: pipeline chart */}
      <g transform="translate(250 24) rotate(4)">
        <rect width="250" height="170" rx="18" fill="url(#auth-card)" />
        <rect className="auth-line" x="20" y="20" width="96" height="10" rx="5" fill="#e3ded2" />
        <rect className="auth-line" x="20" y="38" width="60" height="8" rx="4" fill="#f0ede4" />
        {[52, 86, 64, 112, 96].map((h, i) => (
          <rect
            key={i}
            x={28 + i * 42}
            y={150 - h}
            width="26"
            height={h}
            rx="6"
            fill="url(#auth-bar)"
            opacity={0.55 + i * 0.09}
          />
        ))}
      </g>

      {/* Main board card */}
      <g transform="translate(20 110)">
        <rect width="380" height="270" rx="20" fill="url(#auth-card)" />
        <circle cx="34" cy="34" r="10" fill="#c8102e" />
        <rect x="54" y="26" width="140" height="14" rx="7" className="auth-ink" fill="#0a1628" opacity="0.88" />
        <rect x="290" y="22" width="70" height="24" rx="6" fill="#c8102e" />
        <rect x="302" y="31" width="46" height="6" rx="3" fill="#ffffff" />
        <rect className="auth-line" x="20" y="62" width="340" height="1.5" fill="#e9e4d8" />
        {[
          { y: 82, w: 120, color: '#00874c', group: '#c8102e' },
          { y: 124, w: 96, color: '#b55e0c', group: '#c8102e' },
          { y: 166, w: 132, color: '#e12a47', group: '#0a1628' },
          { y: 208, w: 104, color: '#2d5c94', group: '#0a1628' },
        ].map((row) => (
          <g key={row.y}>
            <rect x="20" y={row.y} width="5" height="32" rx="2.5" fill={row.group} />
            <rect className="auth-line" x="36" y={row.y + 11} width={row.w} height="10" rx="5" fill="#cfc8b8" />
            <circle className="auth-line" cx="220" cy={row.y + 16} r="11" fill="#e3ded2" />
            <rect x="246" y={row.y} width="114" height="32" rx="4" fill={row.color} />
            <rect x="276" y={row.y + 13} width="54" height="6" rx="3" fill="#ffffff" opacity="0.92" />
          </g>
        ))}
      </g>

      {/* Floating status picker */}
      <g transform="translate(330 250)">
        <rect className="auth-surface" width="170" height="150" rx="14" fill="#ffffff" />
        {['#00874c', '#b55e0c', '#e12a47', '#6d7588'].map((color, i) => (
          <g key={color}>
            <rect x="14" y={14 + i * 32} width="142" height="24" rx="4" fill={color} />
            <rect x="56" y={23 + i * 32} width="58" height="6" rx="3" fill="#ffffff" opacity="0.92" />
          </g>
        ))}
      </g>

      {/* Avatar chips */}
      <g transform="translate(46 60)">
        <rect className="auth-surface" width="150" height="40" rx="20" fill="#ffffff" />
        <circle cx="22" cy="20" r="13" fill="#c8102e" />
        <circle cx="44" cy="20" r="13" fill="#566072" className="auth-surface-stroke" stroke="#fff" strokeWidth="3" />
        <circle cx="66" cy="20" r="13" fill="#d55366" className="auth-surface-stroke" stroke="#fff" strokeWidth="3" />
        <rect className="auth-line" x="90" y="15" width="44" height="10" rx="5" fill="#e3ded2" />
      </g>
    </svg>
  );
}
