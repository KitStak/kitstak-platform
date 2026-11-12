'use client';

/**
 * Dashboard card thumbnail drawn from the dashboard's real layout: every widget at its grid
 * position, scaled to one fixed aspect ratio, with a tiny glyph of its kind (bars, KPI value,
 * funnel, table lines...) so two dashboards never look alike.
 */
import type { ReactElement } from 'react';
import { LayoutDashboard } from 'lucide-react';
import type { DashboardWidgetDto } from '@/server/services/contracts/dto';
import { widgetKindOf, type WidgetKind } from '@/server/services/contracts/dashboard-insights';
import { widgetDefinition } from '../lib/catalog';
import { layoutHeight } from '../lib/layout';

const VIEW_W = 120;
const VIEW_H = 60;
const GAP = 1.2;

interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

function glyph(kind: WidgetKind, box: Box, ink: string): ReactElement | null {
  const pad = Math.min(2, box.w / 6, box.h / 6);
  const inner = { x: box.x + pad, y: box.y + pad, w: box.w - pad * 2, h: box.h - pad * 2 };
  if (inner.w < 3 || inner.h < 2) return null;
  const style = { fill: ink };
  switch (kind) {
    case 'numbers':
      return (
        <g style={style}>
          <rect x={inner.x} y={inner.y} width={inner.w * 0.35} height={Math.min(1, inner.h / 4)} rx="0.4" opacity="0.5" />
          <rect x={inner.x} y={inner.y + inner.h * 0.4} width={inner.w * 0.6} height={Math.min(2.4, inner.h / 3)} rx="0.5" />
        </g>
      );
    case 'chart':
    case 'forecast': {
      const bars = 5;
      const width = inner.w / (bars * 1.6);
      return (
        <g style={style}>
          {[0.45, 0.8, 0.6, 1, 0.7].map((ratio, index) => (
            <rect key={index} x={inner.x + index * width * 1.6} y={inner.y + inner.h * (1 - ratio)} width={width} height={inner.h * ratio} rx="0.4" />
          ))}
        </g>
      );
    }
    case 'battery':
      return (
        <g style={style}>
          {[0.45, 0.3, 0.25].reduce<{ at: number; nodes: ReactElement[] }>(
            (acc, ratio, index) => ({
              at: acc.at + inner.w * ratio,
              nodes: [...acc.nodes, <rect key={index} x={inner.x + acc.at} y={inner.y + inner.h / 2 - 1.2} width={inner.w * ratio - 0.4} height={2.4} opacity={1 - index * 0.3} />],
            }),
            { at: 0, nodes: [] },
          ).nodes}
        </g>
      );
    case 'funnel':
      return (
        <g style={style}>
          {[1, 0.75, 0.5, 0.3].map((ratio, index) => (
            <rect key={index} x={inner.x} y={inner.y + index * (inner.h / 4)} width={inner.w * ratio} height={Math.max(inner.h / 4 - 0.8, 0.6)} rx="0.4" />
          ))}
        </g>
      );
    case 'leaderboard':
    case 'workload':
      return (
        <g style={style}>
          {[1, 0.8, 0.6, 0.45].map((ratio, index) => (
            <g key={index}>
              <circle cx={inner.x + 1} cy={inner.y + index * (inner.h / 4) + 1} r="0.9" />
              <rect x={inner.x + 3} y={inner.y + index * (inner.h / 4) + 0.5} width={(inner.w - 3) * ratio} height="1" rx="0.4" opacity="0.6" />
            </g>
          ))}
        </g>
      );
    case 'table':
    case 'calendar':
    case 'timeline':
      return (
        <g style={style} opacity="0.6">
          {Array.from({ length: Math.max(2, Math.min(6, Math.floor(inner.h / 2.2))) }, (_, index) => (
            <rect
              key={index}
              x={inner.x + (kind === 'timeline' ? (index % 3) * inner.w * 0.15 : 0)}
              y={inner.y + index * 2.2}
              width={kind === 'timeline' ? inner.w * 0.45 : inner.w}
              height="0.9"
              rx="0.4"
            />
          ))}
        </g>
      );
    case 'text':
      return (
        <g style={style} opacity="0.5">
          <rect x={inner.x} y={inner.y} width={inner.w * 0.8} height="0.9" rx="0.4" />
          <rect x={inner.x} y={inner.y + 2} width={inner.w * 0.6} height="0.9" rx="0.4" />
        </g>
      );
    case 'countdown':
      return (
        <g style={style}>
          {[0, 1, 2, 3].map((index) => (
            <rect key={index} x={inner.x + index * (inner.w / 4)} y={inner.y + inner.h / 2 - 1.5} width={inner.w / 4 - 0.8} height="3" rx="0.6" />
          ))}
        </g>
      );
    case 'section':
      return null;
  }
}

export function LayoutThumbnail({ widgets }: { readonly widgets: readonly DashboardWidgetDto[] }) {
  if (widgets.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-fg-muted">
        <LayoutDashboard aria-hidden className="size-8 opacity-50" />
      </div>
    );
  }
  // Fit the whole layout: a column is VIEW_W / 12 wide, rows shrink so every widget is shown.
  const rows = Math.max(layoutHeight(widgets), 6);
  const col = VIEW_W / 12;
  const row = Math.min(VIEW_H / rows, col * 0.75);
  const offsetY = Math.max((VIEW_H - rows * row) / 2, 0);
  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="xMidYMid meet" className="h-full w-full" aria-hidden data-testid="dashboard-thumbnail">
      {widgets.map((widget) => {
        const kind = widgetKindOf(widget.type, widget.config);
        const definition = widgetDefinition(kind);
        const box = {
          x: widget.x * col + GAP / 2,
          y: offsetY + widget.y * row + GAP / 2,
          w: Math.max(widget.w * col - GAP, 1),
          h: Math.max(widget.h * row - GAP, 1),
        };
        const ink = `var(--label-${definition.tone})`;
        return (
          <g key={widget.id}>
            <rect
              x={box.x}
              y={box.y}
              width={box.w}
              height={box.h}
              rx="1.2"
              style={{
                fill: definition.chromeless ? 'transparent' : 'var(--surface-panel)',
                stroke: definition.chromeless ? 'transparent' : 'var(--border-default)',
                strokeWidth: 0.3,
              }}
            />
            {definition.chromeless ? (
              <rect x={box.x} y={box.y + box.h - 1.5} width={box.w * 0.3} height="1" rx="0.4" style={{ fill: 'var(--text-muted)' }} />
            ) : (
              glyph(kind, box, ink)
            )}
          </g>
        );
      })}
    </svg>
  );
}
