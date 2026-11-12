/**
 * Chart data export (CSV / XLSX) and cell formatting for the analytics tables. The XLSX
 * writer (exceljs) is imported on demand so it never weighs on the page bundle.
 */
import type { AnalyticsChart, AnalyticsColumn } from "@/server/repositories/analytics-types";

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function formatCell(value: unknown, col: AnalyticsColumn): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value !== "number") return String(value);
  switch (col.kind) {
    case "money": return money.format(value);
    case "percent": return `${nf.format(value)}%`;
    case "hours": return `${nf.format(value)} h`;
    case "minutes": return `${nf.format(value)} min`;
    default: return nf.format(value);
  }
}

const csvCell = (v: unknown): string => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"` : s;
};

/** CSV text of a chart's rows (formula-injection safe). */
export function chartToCsv(chart: AnalyticsChart): string {
  const head = chart.columns.map((c) => csvCell(c.label)).join(",");
  const body = chart.rows.map((r) => chart.columns.map((c) => csvCell(r[c.key])).join(","));
  return [head, ...body].join("\r\n");
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

function save(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadChartCsv(chart: AnalyticsChart, stem: string): void {
  save(new Blob([`﻿${chartToCsv(chart)}`], { type: "text/csv;charset=utf-8" }), `${slug(stem)}-${slug(chart.title)}.csv`);
}

export async function downloadChartXlsx(chart: AnalyticsChart, stem: string): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(chart.title.slice(0, 31));
  ws.columns = chart.columns.map((c) => ({ header: c.label, key: c.key, width: Math.max(12, c.label.length + 4) }));
  for (const r of chart.rows) ws.addRow(Object.fromEntries(chart.columns.map((c) => [c.key, r[c.key] ?? null])));
  ws.getRow(1).font = { bold: true };
  const buf = await wb.xlsx.writeBuffer();
  save(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${slug(stem)}-${slug(chart.title)}.xlsx`);
}
