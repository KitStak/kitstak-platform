/**
 * The monthly program report as files: a CSV (one section after another, plain numbers), and a
 * self contained HTML page to print or save as PDF. Pure. The cells read exactly as the report
 * page and the Pulse report library read them (`reportCellText`, `reportCellCsv`).
 */
import { toCsv, type CsvCell } from '@/lib/csv/write';
import { formatNumber, formatPercentBp } from '@/lib/format';
import type { ReportCell, ReportCellKind } from '@/lib/types';
import { escapeHtml, reportCellCsv, reportCellText } from '@/features/reports/report-format';
import type { ProgramReportDTO, ProgramReportTable } from './program-report';

const NUMERIC: ReadonlySet<ReportCellKind> = new Set<ReportCellKind>(['money', 'percent', 'number', 'hours', 'pace']);

/**
 * One cell as it reads in print and in the PDF: the report library's words, with percents and
 * hours kept to a fixed number of places so a column lines up ("70.0%" over "69.8%").
 */
export function cellText(value: ReportCell, kind: ReportCellKind): string {
  if (value === null || value === undefined || value === '') return '';
  if (kind === 'percent') return formatPercentBp(Number(value), { fixed: true });
  if (kind === 'hours') return formatNumber(Number(value), { minDigits: 2, maxDigits: 2 });
  return reportCellText(value, kind);
}

/** How many totals go across: four at most, and never one alone on the last row. */
export function summaryColumns(count: number): number {
  if (count <= 4) return Math.max(1, count);
  return count % 4 === 0 ? 4 : 3;
}

/** A summary value as it reads on the page and in print. */
export function summaryText(item: ProgramReportDTO['summary'][number]): string {
  if (item.kind === 'number') return reportCellText(item.value, 'number');
  return item.value === null || item.value === undefined ? 'None' : cellText(item.value, item.kind);
}

/** One cell of a report table as it reads on the page, in print and in the PDF. */
export function tableCellText(table: ProgramReportTable, key: string, value: Parameters<typeof reportCellText>[0]): string {
  const column = table.columns.find((item) => item.key === key);
  return column ? cellText(value, column.kind) : '';
}

/** Built time in words, the same on every copy: "Nov 26, 2026, 15:04 UTC". */
export function builtWords(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[at.getUTCMonth()]} ${at.getUTCDate()}, ${at.getUTCFullYear()}, ${at.toISOString().slice(11, 16)} UTC`;
}

/** Header lines every copy starts with. */
export function reportHeaderLines(report: ProgramReportDTO, orgName: string): string[] {
  return [report.subtitle, [report.versionLabel, report.cardLabel, orgName].filter(Boolean).join(', '), report.statusNote];
}

/** The report as CSV text: the header, the totals, each table with its total row, then the notes. */
export function programReportToCsv(report: ProgramReportDTO, options: { readonly orgName: string }): string {
  const lines: CsvCell[][] = [];
  for (const line of reportHeaderLines(report, options.orgName)) lines.push([line]);
  lines.push([]);
  lines.push(['Totals']);
  for (const item of report.summary) lines.push([item.kind === 'percent' ? `${item.label} (%)` : item.label, reportCellCsv(item.value, item.kind)]);
  for (const table of report.tables) {
    lines.push([]);
    lines.push([table.title]);
    lines.push(table.columns.map((column) => (column.kind === 'percent' ? `${column.label} (%)` : column.label)));
    for (const row of table.rows) lines.push(table.columns.map((column) => reportCellCsv(row.cells[column.key] ?? null, column.kind)));
    if (table.total) lines.push(table.columns.map((column) => reportCellCsv(table.total?.[column.key] ?? null, column.kind)));
  }
  if (report.notes.length > 0) {
    lines.push([]);
    lines.push(['Notes']);
    for (const note of report.notes) lines.push([note]);
  }
  return toCsv([report.title], lines);
}

function tableHtml(table: ProgramReportTable): string {
  const head = table.columns.map((column) => `<th class="${NUMERIC.has(column.kind) ? 'n' : ''}">${escapeHtml(column.label)}</th>`).join('');
  const body = table.rows
    .map((row) => `<tr>${table.columns.map((column) => `<td class="${NUMERIC.has(column.kind) ? 'n' : ''}">${escapeHtml(cellText(row.cells[column.key] ?? null, column.kind))}</td>`).join('')}</tr>`)
    .join('\n');
  const total = table.total ? `<tfoot><tr>${table.columns.map((column) => `<td class="${NUMERIC.has(column.kind) ? 'n' : ''}">${escapeHtml(cellText(table.total?.[column.key] ?? null, column.kind))}</td>`).join('')}</tr></tfoot>` : '';
  return `<section><h2>${escapeHtml(table.title)}</h2>${table.rows.length === 0 ? '<p class="empty">Nothing this month.</p>' : `<table><thead><tr>${head}</tr></thead><tbody>\n${body}\n</tbody>${total}</table>`}</section>`;
}

/**
 * The report as one self contained page: header, totals, tables and notes. No outside files, so
 * it prints cleanly and the browser can save it as a PDF. `autoPrint` opens the print box.
 */
export function programReportToHtml(report: ProgramReportDTO, options: { readonly orgName: string; readonly autoPrint?: boolean; readonly nonce?: string }): string {
  const summary = `<dl class="summary" style="grid-template-columns: repeat(${summaryColumns(report.summary.length)}, minmax(0, 1fr))">${report.summary
    .map((item) => `<div><dt>${escapeHtml(item.label)}</dt><dd>${escapeHtml(summaryText(item))}</dd>${item.note ? `<p class="note">${escapeHtml(item.note)}</p>` : ''}</div>`)
    .join('')}</dl>`;
  const notes = report.notes.length ? `<section><h2>Notes</h2><ul class="notes">${report.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}</ul></section>` : '';
  const meta = [report.versionLabel, report.cardLabel].filter(Boolean).join(' · ');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(report.title)}, ${escapeHtml(report.monthLabel)}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 32px; font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #16181d; background: #fff; }
  header { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; border-bottom: 2px solid #16181d; padding-bottom: 12px; }
  h1 { margin: 0; font-size: 22px; letter-spacing: -0.01em; }
  h2 { margin: 24px 0 0; font-size: 14px; }
  .sub { margin: 4px 0 0; color: #555b66; }
  .meta { text-align: right; color: #555b66; font-size: 12px; white-space: nowrap; }
  .status { margin: 12px 0 0; padding: 8px 12px; border: 1px solid #d5d8de; border-radius: 6px; font-weight: 600; }
  .status.open { border-color: #c9a227; background: #fdf8e6; }
  .summary { display: grid; gap: 12px 24px; margin: 16px 0 0; }
  .summary dt { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #555b66; }
  .summary dd { margin: 2px 0 0; font-size: 18px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .summary .note { margin: 2px 0 0; font-size: 11px; color: #555b66; }
  .notes { margin: 8px 0 0; padding-left: 18px; color: #343841; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; font-variant-numeric: tabular-nums; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #555b66; border-bottom: 1px solid #16181d; padding: 6px 8px; vertical-align: bottom; }
  td { padding: 5px 8px; border-bottom: 1px solid #e3e5ea; vertical-align: top; }
  .n { text-align: right; white-space: nowrap; }
  tfoot td { font-weight: 700; border-top: 2px solid #16181d; border-bottom: 0; }
  .empty { margin-top: 8px; color: #555b66; }
  footer { margin-top: 32px; color: #8a8f99; font-size: 11px; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  section { break-inside: auto; }
  @media print { body { padding: 0; } @page { margin: 14mm; } }
</style>
</head>
<body>
<header>
  <div>
    <h1>${escapeHtml(report.title)}</h1>
    <p class="sub">${escapeHtml(report.subtitle)}</p>
  </div>
  <div class="meta">${escapeHtml(options.orgName)}<br>${escapeHtml(meta)}<br>Built ${escapeHtml(builtWords(report.generatedAt))}</div>
</header>
<p class="status ${report.final ? 'final' : 'open'}">${escapeHtml(report.statusNote)}</p>
${summary}
${report.tables.map(tableHtml).join('\n')}
${notes}
<footer>KitStak Pulse</footer>
${options.autoPrint ? `<script${options.nonce ? ` nonce="${escapeHtml(options.nonce)}"` : ''}>window.addEventListener("load", function () { window.print(); });</script>` : ''}
</body>
</html>`;
}
