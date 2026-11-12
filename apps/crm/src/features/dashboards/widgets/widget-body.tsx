'use client';

/** Chooses the renderer for a widget kind and handles loading / error / unconfigured states. */
import type { ReactNode } from 'react';
import type { InsightDto, WidgetKind } from '@/server/services/contracts/dashboard-insights';
import { ChartWidget } from './chart-widget';
import { CountdownWidget, SectionWidget, TextWidget } from './content-widgets';
import { ForecastWidget } from './forecast-widget';
import { NumbersWidget } from './numbers-widget';
import { BatteryWidget, FunnelWidget, LeaderboardWidget } from './pipeline-widgets';
import { ErrorState, UnconfiguredState, WidgetSkeleton } from './shared';
import { TableWidget } from './table-widget';
import { CalendarWidget, TimelineWidget } from './time-widgets';
import type { WidgetRenderProps } from './types';
import { WorkloadWidget } from './workload-widget';

const RENDERERS: Readonly<Record<WidgetKind, (props: WidgetRenderProps) => ReactNode>> = {
  numbers: NumbersWidget,
  chart: ChartWidget,
  battery: BatteryWidget,
  table: TableWidget,
  workload: WorkloadWidget,
  calendar: CalendarWidget,
  timeline: TimelineWidget,
  leaderboard: LeaderboardWidget,
  funnel: FunnelWidget,
  forecast: ForecastWidget,
  text: TextWidget,
  countdown: CountdownWidget,
  section: SectionWidget,
};

/** Kinds that never read board data (render immediately, no insight query). */
export const STATIC_KINDS: ReadonlySet<WidgetKind> = new Set(['text', 'countdown', 'section']);

export interface WidgetBodyProps extends Omit<WidgetRenderProps, 'insight'> {
  readonly kind: WidgetKind;
  readonly insight: InsightDto | undefined;
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly onRetry: () => void;
}

export function WidgetBody({ kind, insight, isPending, isError, onRetry, ...props }: WidgetBodyProps) {
  const Renderer = RENDERERS[kind];
  if (STATIC_KINDS.has(kind)) return <Renderer {...props} insight={insight ?? EMPTY_INSIGHT(kind)} />;
  if (isError && !insight) return <ErrorState onRetry={onRetry} />;
  if (isPending || !insight) return <WidgetSkeleton kind={kind} />;
  if (insight.unconfigured) return <UnconfiguredState onConfigure={props.onConfigure} />;
  return <Renderer {...props} insight={insight} />;
}

function EMPTY_INSIGHT(kind: WidgetKind): InsightDto {
  return {
    kind,
    total: 0,
    itemCount: 0,
    comparison: null,
    sparkline: [],
    series: [],
    stacks: [],
    boards: [],
    valueColumn: null,
    doneRatio: null,
    forecast: [],
    workload: null,
    rows: [],
    rowsTruncated: false,
    columns: [],
    tableKeys: [],
    groups: [],
    users: [],
    unconfigured: false,
    generatedAt: '',
  };
}
