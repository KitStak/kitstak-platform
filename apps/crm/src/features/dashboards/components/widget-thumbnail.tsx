/** Original miniature previews for the widget gallery (token colors only). */
import type { ReactNode } from 'react';
import type { WidgetKind } from '@/server/services/contracts/dashboard-insights';

const c = (name: string) => `var(--label-${name})`;
const SUB = 'var(--border-default)';
const MUTED = 'var(--surface-muted)';

function Frame({ children }: { readonly children: ReactNode }) {
  return (
    <svg viewBox="0 0 160 96" className="h-full w-full" aria-hidden>
      <rect x="0.5" y="0.5" width="159" height="95" rx="8" style={{ fill: 'var(--surface-panel)', stroke: SUB }} />
      {children}
    </svg>
  );
}

export function WidgetThumbnail({ kind }: { readonly kind: WidgetKind }) {
  switch (kind) {
    case 'numbers':
      return (
        <Frame>
          <rect x="44" y="26" width="72" height="22" rx="4" style={{ fill: c('blue') }} />
          <rect x="60" y="54" width="40" height="8" rx="4" style={{ fill: c('green-light') }} />
          <polyline points="20,82 45,76 70,79 95,70 120,72 140,64" style={{ fill: 'none', stroke: c('blue'), strokeWidth: 2 }} />
        </Frame>
      );
    case 'chart':
      return (
        <Frame>
          {[30, 52, 22, 64, 44, 58].map((height, index) => (
            <rect key={index} x={18 + index * 22} y={82 - height} width="14" height={height} rx="2" style={{ fill: c(['blue', 'purple', 'teal', 'orange', 'pink', 'indigo'][index] ?? 'blue') }} />
          ))}
        </Frame>
      );
    case 'battery':
      return (
        <Frame>
          <rect x="16" y="22" width="40" height="10" rx="2" style={{ fill: SUB }} />
          <rect x="16" y="42" width="58" height="18" style={{ fill: c('green') }} />
          <rect x="74" y="42" width="36" height="18" style={{ fill: c('orange') }} />
          <rect x="110" y="42" width="20" height="18" style={{ fill: c('red') }} />
          <rect x="130" y="42" width="14" height="18" style={{ fill: c('gray') }} />
          {[0, 1, 2, 3].map((index) => (
            <circle key={index} cx={20 + index * 30} cy="74" r="4" style={{ fill: c(['green', 'orange', 'red', 'gray'][index] ?? 'gray') }} />
          ))}
        </Frame>
      );
    case 'table':
      return (
        <Frame>
          <rect x="12" y="12" width="136" height="12" rx="2" style={{ fill: MUTED }} />
          {[0, 1, 2, 3].map((row) => (
            <g key={row}>
              <rect x="12" y={30 + row * 15} width="4" height="11" style={{ fill: c('blue') }} />
              <rect x="20" y={33 + row * 15} width="54" height="5" rx="2" style={{ fill: SUB }} />
              <rect x="84" y={30 + row * 15} width="30" height="11" rx="2" style={{ fill: c(['green', 'orange', 'purple', 'red'][row] ?? 'green') }} />
              <rect x="120" y={33 + row * 15} width="26" height="5" rx="2" style={{ fill: SUB }} />
            </g>
          ))}
        </Frame>
      );
    case 'funnel':
      return (
        <Frame>
          {[120, 96, 72, 46].map((width, index) => (
            <rect key={index} x={80 - width / 2} y={14 + index * 18} width={width} height="13" rx="3" style={{ fill: c(['sky', 'blue', 'purple', 'orange'][index] ?? 'blue') }} />
          ))}
        </Frame>
      );
    case 'forecast':
      return (
        <Frame>
          {[0, 1, 2, 3, 4, 5].map((index) => {
            const won = [16, 6, 0, 0, 0, 0][index] ?? 0;
            const weighted = [18, 26, 14, 10, 16, 12][index] ?? 0;
            const upside = [22, 30, 20, 16, 22, 18][index] ?? 0;
            const x = 18 + index * 22;
            return (
              <g key={index}>
                <rect x={x} y={82 - won} width="14" height={won} style={{ fill: c('green') }} />
                <rect x={x} y={82 - won - weighted} width="14" height={weighted} style={{ fill: c('blue') }} />
                <rect x={x} y={82 - won - weighted - upside} width="14" height={upside} rx="2" style={{ fill: c('blue-light') }} />
              </g>
            );
          })}
        </Frame>
      );
    case 'leaderboard':
      return (
        <Frame>
          {[0, 1, 2, 3].map((row) => (
            <g key={row}>
              <circle cx="22" cy={22 + row * 17} r="5" style={{ fill: c(['yellow', 'gray', 'brown', 'blue-light'][row] ?? 'gray') }} />
              <circle cx="38" cy={22 + row * 17} r="6" style={{ fill: c(['purple', 'teal', 'pink', 'indigo'][row] ?? 'blue') }} />
              <rect x="50" y={19 + row * 17} width={[90, 70, 52, 34][row]} height="6" rx="3" style={{ fill: c('blue') }} />
            </g>
          ))}
        </Frame>
      );
    case 'workload':
      return (
        <Frame>
          {[0, 1, 2].map((row) =>
            [0, 1, 2, 3, 4].map((col) => {
              const load = (row * 5 + col * 3) % 7;
              const tone = load > 5 ? 'red' : load > 3 ? 'orange' : 'green';
              return <circle key={`${row}-${col}`} cx={52 + col * 22} cy={24 + row * 24} r={4 + load} style={{ fill: c(tone) }} />;
            }),
          )}
          {[0, 1, 2].map((row) => (
            <rect key={row} x="12" y={21 + row * 24} width="22" height="6" rx="3" style={{ fill: SUB }} />
          ))}
        </Frame>
      );
    case 'calendar':
      return (
        <Frame>
          {Array.from({ length: 21 }, (_, index) => (
            <rect key={index} x={12 + (index % 7) * 20} y={14 + Math.floor(index / 7) * 26} width="17" height="22" rx="2" style={{ fill: MUTED }} />
          ))}
          <rect x="34" y="24" width="15" height="5" rx="1" style={{ fill: c('purple') }} />
          <rect x="94" y="50" width="15" height="5" rx="1" style={{ fill: c('green') }} />
          <rect x="54" y="76" width="15" height="5" rx="1" style={{ fill: c('orange') }} />
        </Frame>
      );
    case 'timeline':
      return (
        <Frame>
          {[0, 1, 2, 3].map((row) => (
            <rect key={row} x={[20, 44, 70, 34][row]} y={18 + row * 17} width={[56, 70, 50, 90][row]} height="9" rx="4.5" style={{ fill: c(['blue', 'purple', 'orange', 'teal'][row] ?? 'blue') }} />
          ))}
          <line x1="98" y1="10" x2="98" y2="88" style={{ stroke: 'var(--danger)', strokeWidth: 1.5 }} />
        </Frame>
      );
    case 'countdown':
      return (
        <Frame>
          {[0, 1, 2, 3].map((index) => (
            <rect key={index} x={16 + index * 34} y="28" width="28" height="30" rx="4" style={{ fill: c('berry-subtle') }} />
          ))}
          {[0, 1, 2, 3].map((index) => (
            <rect key={index} x={22 + index * 34} y="40" width="16" height="6" rx="2" style={{ fill: c('berry') }} />
          ))}
        </Frame>
      );
    case 'text':
      return (
        <Frame>
          <rect x="16" y="18" width="70" height="8" rx="3" style={{ fill: c('lime') }} />
          {[0, 1, 2, 3].map((row) => (
            <rect key={row} x="16" y={36 + row * 12} width={[128, 110, 120, 70][row]} height="5" rx="2" style={{ fill: SUB }} />
          ))}
        </Frame>
      );
    case 'section':
      return (
        <Frame>
          <rect x="16" y="34" width="90" height="12" rx="3" style={{ fill: 'var(--text-secondary)' }} />
          <rect x="16" y="56" width="128" height="2" style={{ fill: SUB }} />
        </Frame>
      );
  }
}
