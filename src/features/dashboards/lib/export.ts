/** CSV export of a widget's data (series, forecast buckets, workload or item rows). */
import type { InsightDto } from '@/server/services/contracts/dashboard-insights';

function escape(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  // Neutralise spreadsheet formula injection and quote when needed.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function insightToCsv(insight: InsightDto): string {
  let rows: unknown[][];
  if (insight.forecast.length > 0) {
    rows = [['Month', 'Open pipeline', 'Weighted', 'Won', 'Deals'], ...insight.forecast.map((b) => [b.label, b.pipeline, b.weighted, b.won, b.count])];
  } else if (insight.workload) {
    const { periods, rows: people } = insight.workload;
    rows = [['Person', ...periods.map((p) => p.label), 'Total'], ...people.map((p) => [p.name, ...p.cells, p.total])];
  } else if (insight.rows.length > 0) {
    rows = [['Item', 'Board', 'Group'], ...insight.rows.map((item) => [
      item.name,
      insight.boards.find((board) => board.id === item.boardId)?.name ?? '',
      insight.groups.find((group) => group.id === item.groupId)?.title ?? '',
    ])];
  } else if (insight.series.length > 0) {
    const stackKeys = insight.stacks.map((stack) => stack.key);
    rows = [
      ['Label', 'Value', 'Items', ...insight.stacks.map((stack) => stack.label)],
      ...insight.series.map((point) => [point.label, point.value, point.count, ...stackKeys.map((key) => point.stack?.[key] ?? 0)]),
    ];
  } else {
    rows = [['Value', 'Items'], [insight.total, insight.itemCount]];
  }
  return rows.map((row) => row.map(escape).join(',')).join('\n');
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename.replace(/[^\w\- ]+/g, '').trim() || 'widget'}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
