/**
 * How a built report turns into words: one cell as text for the screen, the whole report as a CSV
 * file, and as a plain HTML page to print or paste. Pure functions, used by the report page, the
 * download routes and scheduled builds, so all four show the same numbers.
 */
import { JOB_STATUS_LABELS, PULSE_STATUS_LABELS, type JobStatusValue, type PulseStatus } from '@/lib/constants';
import { toCsv, type CsvCell } from '@/lib/csv/write';
import { formatDecimalPlain, formatHours, formatMoney, formatMoneyPlain, formatNumber, formatPace, formatPercentBp } from '@/lib/format';
import { shortDate } from '@/lib/profit/calendar';
import type { ReportCell, ReportCellKind, ReportDTO } from '@/lib/types';

const EMPTY = '';

function statusWords(value: string): string {
  return PULSE_STATUS_LABELS[value as PulseStatus] ?? JOB_STATUS_LABELS[value as JobStatusValue] ?? value;
}

function dateTimeWords(value: string): string {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value;
  return `${shortDate(at.toISOString().slice(0, 10))}, ${at.toISOString().slice(11, 16)} UTC`;
}

/** One cell as it reads on screen and in print. A hidden or missing value reads as `empty`. */
export function reportCellText(value: ReportCell, kind: ReportCellKind, empty = EMPTY): string {
  if (value === null || value === undefined || value === '') return empty;
  switch (kind) {
    case 'money':
      return formatMoney(Number(value));
    case 'percent':
      return formatPercentBp(Number(value));
    case 'number':
      return formatNumber(Number(value), { maxDigits: 1 });
    case 'hours':
      return formatHours(Number(value));
    case 'pace':
      return formatPace(Number(value));
    case 'date':
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${shortDate(value)}, ${value.slice(0, 4)}` : String(value);
    case 'datetime':
      return dateTimeWords(String(value));
    case 'status':
    case 'job_status':
      return statusWords(String(value));
    case 'text':
      return String(value);
  }
}

/** One cell as a spreadsheet wants it: plain numbers, no currency sign, percent as a number. */
export function reportCellCsv(value: ReportCell, kind: ReportCellKind): CsvCell {
  if (value === null || value === undefined || value === '') return '';
  switch (kind) {
    case 'money':
      return formatMoneyPlain(Number(value));
    case 'percent':
      return formatDecimalPlain(Number(value) / 100, 2);
    case 'number':
    case 'hours':
    case 'pace':
      return String(value);
    case 'status':
    case 'job_status':
      return statusWords(String(value));
    default:
      return String(value);
  }
}

/** A header that says what unit a column is in, so the file reads without the screen. */
function csvHeader(label: string, kind: ReportCellKind): string {
  if (kind === 'percent') return `${label} (%)`;
  return label;
}

/** The report as CSV text: one header row, the rows as shown, then the total row when there is one. */
export function reportToCsv(report: Pick<ReportDTO, 'columns' | 'rows' | 'total'>): string {
  const headers = report.columns.map((column) => csvHeader(column.label, column.kind));
  const lines: CsvCell[][] = report.rows.map((row) => report.columns.map((column) => reportCellCsv(row.cells[column.key] ?? null, column.kind)));
  if (report.total) {
    const total = report.total;
    lines.push(report.columns.map((column, index) => (index === 0 && (total[column.key] === null || total[column.key] === undefined) ? 'Total' : reportCellCsv(total[column.key] ?? null, column.kind))));
  }
  return toCsv(headers, lines);
}

const ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapes text for HTML. Every job, client and note goes through this. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

const NUMERIC: ReadonlySet<ReportCellKind> = new Set<ReportCellKind>(['money', 'percent', 'number', 'hours', 'pace']);

/**
 * The report as one self contained HTML page: a heading, the summary, the notes and the table.
 * No scripts and no outside files, so it prints cleanly and pastes into an email or a document.
 */
export function reportToHtml(report: ReportDTO, options: { orgName: string; autoPrint?: boolean }): string {
  const head = report.columns.map((column) => `<th class="${NUMERIC.has(column.kind) ? 'n' : ''}">${escapeHtml(column.label)}</th>`).join('');
  const body = report.rows
    .map((row) => `<tr>${report.columns.map((column) => `<td class="${NUMERIC.has(column.kind) ? 'n' : ''}">${escapeHtml(reportCellText(row.cells[column.key] ?? null, column.kind))}</td>`).join('')}</tr>`)
    .join('\n');
  const total = report.total
    ? `<tfoot><tr>${report.columns
        .map((column, index) => {
          const value = report.total?.[column.key] ?? null;
          const text = index === 0 && (value === null || value === '') ? 'Total' : reportCellText(value, column.kind);
          return `<td class="${NUMERIC.has(column.kind) ? 'n' : ''}">${escapeHtml(text)}</td>`;
        })
        .join('')}</tr></tfoot>`
    : '';
  const summary = report.summary.length
    ? `<dl class="summary">${report.summary.map((item) => `<div><dt>${escapeHtml(item.label)}</dt><dd>${escapeHtml(reportCellText(item.value, item.kind, 'Hidden'))}</dd></div>`).join('')}</dl>`
    : '';
  const notes = [...report.notes, ...(report.truncated ? ['This report is long. Only the first rows are shown. Narrow the dates to see the rest.'] : []), ...(report.moneyHidden ? ['Money is left out of this copy.'] : [])];
  const notesHtml = notes.length ? `<ul class="notes">${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}</ul>` : '';
  const built = dateTimeWords(report.generatedAt);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(report.name)}, ${escapeHtml(options.orgName)}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 32px; font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #16181d; background: #fff; }
  header { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; border-bottom: 2px solid #16181d; padding-bottom: 12px; }
  h1 { margin: 0; font-size: 22px; letter-spacing: -0.01em; }
  .sub { margin: 4px 0 0; color: #555b66; }
  .meta { text-align: right; color: #555b66; font-size: 12px; white-space: nowrap; }
  .summary { display: flex; flex-wrap: wrap; gap: 12px 32px; margin: 16px 0 0; }
  .summary div { min-width: 120px; }
  .summary dt { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #555b66; }
  .summary dd { margin: 2px 0 0; font-size: 18px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .notes { margin: 16px 0 0; padding-left: 18px; color: #555b66; }
  table { width: 100%; border-collapse: collapse; margin-top: 20px; font-variant-numeric: tabular-nums; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #555b66; border-bottom: 1px solid #16181d; padding: 6px 8px; vertical-align: bottom; }
  td { padding: 6px 8px; border-bottom: 1px solid #e3e5ea; vertical-align: top; }
  .n { text-align: right; white-space: nowrap; }
  tfoot td { font-weight: 700; border-top: 2px solid #16181d; border-bottom: 0; }
  .empty { margin-top: 24px; color: #555b66; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  @media print { body { padding: 0; } @page { margin: 14mm; } }
</style>
</head>
<body>
<header>
  <div>
    <h1>${escapeHtml(report.name)}</h1>
    <p class="sub">${escapeHtml(report.filtersLabel)}</p>
  </div>
  <div class="meta">${escapeHtml(options.orgName)}<br>Built ${escapeHtml(built)}<br>KitStak Pulse</div>
</header>
${summary}
${notesHtml}
${report.rows.length === 0 ? '<p class="empty">Nothing to show for these filters.</p>' : `<table><thead><tr>${head}</tr></thead><tbody>\n${body}\n</tbody>${total}</table>`}
${options.autoPrint ? '<script>window.addEventListener("load", function () { window.print(); });</script>' : ''}
</body>
</html>`;
}
