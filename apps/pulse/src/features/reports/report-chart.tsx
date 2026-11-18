'use client';
/** Draws the chart a built report carries, with the one chart library. */
import { BarChart, ComboChart, LineChart, ParetoChart, WaterfallChart } from '@/components/charts/cartesian';
import type { ReportChartDTO } from '@/lib/types';

export function ReportChart({ chart, height = 300, refreshing }: { readonly chart: ReportChartDTO; readonly height?: number; readonly refreshing?: boolean }) {
  const base = { title: chart.title, description: chart.description, height, refreshing, tableToggle: true } as const;
  const series = chart.series.map((item) => ({ id: item.id, label: item.label, values: [...item.values] }));
  switch (chart.type) {
    case 'hbar':
      return <BarChart {...base} orientation="horizontal" labels={chart.labels} series={series} format={chart.format} signColors={chart.signColors && series.length === 1} height={Math.max(height, chart.labels.length * 30 + 56)} hideLegend={series.length === 1} />;
    case 'stacked':
      return <BarChart {...base} mode="stacked" labels={chart.labels} series={series} format={chart.format} />;
    case 'line':
      return <LineChart {...base} labels={chart.labels} series={series} format={chart.format} />;
    case 'combo':
      return <ComboChart {...base} labels={chart.labels} bars={series} lines={(chart.lines ?? []).map((item) => ({ id: item.id, label: item.label, values: [...item.values] }))} barFormat={chart.format} lineFormat={chart.lineFormat} />;
    case 'waterfall':
      return <WaterfallChart {...base} start={chart.start ?? { label: 'Start', value: 0 }} steps={chart.labels.map((label, index) => ({ id: `${index}`, label, value: chart.series[0]?.values[index] ?? 0 }))} endLabel={chart.endLabel ?? 'End'} format={chart.format} />;
    case 'pareto':
      return <ParetoChart {...base} items={chart.labels.map((label, index) => ({ id: `${index}`, label, value: chart.series[0]?.values[index] ?? 0 }))} format={chart.format} valueLabel={chart.series[0]?.label} />;
    default:
      return <BarChart {...base} labels={chart.labels} series={series} format={chart.format} signColors={chart.signColors && series.length === 1} hideLegend={series.length === 1} />;
  }
}
