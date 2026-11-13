'use client';

/**
 * One-shot celebration burst for the setup guide, rendered inside its (relative)
 * parent. Pure CSS motion (compositor-friendly transform/opacity only), token
 * colors so it reads on-brand in both themes, hidden entirely under
 * prefers-reduced-motion. Portal parity: apps/portal/src/features/setup/confetti.tsx.
 */
import * as React from 'react';

interface Piece {
  readonly id: number;
  readonly left: number;
  readonly delay: number;
  readonly duration: number;
  readonly spin: number;
  readonly color: string;
  readonly width: number;
  readonly height: number;
}

/** Token colors only, so the burst reads on-brand in both themes. */
const COLORS = [
  'var(--primary)',
  'var(--success)',
  'var(--info)',
  'var(--warning-accent, var(--warning))',
  'var(--brand-navy, var(--text-primary))',
];

function makePieces(count: number): readonly Piece[] {
  return Array.from({ length: count }, (_, id) => ({
    id,
    left: Math.random() * 100,
    delay: Math.random() * 350,
    duration: 900 + Math.random() * 900,
    spin: (Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 540),
    color: COLORS[id % COLORS.length],
    width: 5 + Math.random() * 4,
    height: 8 + Math.random() * 6,
  }));
}

export function ConfettiBurst({ pieceCount = 26 }: { readonly pieceCount?: number }) {
  const [pieces, setPieces] = React.useState<readonly Piece[]>([]);
  React.useEffect(() => {
    setPieces(makePieces(pieceCount));
  }, [pieceCount]);
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 block h-full overflow-hidden motion-reduce:hidden"
    >
      {pieces.map((piece) => (
        <span
          key={piece.id}
          className="absolute top-[-12px] block animate-confetti-fall rounded-[1px]"
          style={{
            left: `${piece.left}%`,
            width: piece.width,
            height: piece.height,
            background: piece.color,
            animationDelay: `${piece.delay}ms`,
            animationDuration: `${piece.duration}ms`,
            ['--ks-confetti-spin' as string]: `${piece.spin}deg`,
          }}
        />
      ))}
    </span>
  );
}
