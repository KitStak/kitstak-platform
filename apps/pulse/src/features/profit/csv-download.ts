'use client';
import { toCsv, type CsvCell } from '@/lib/csv/write';

/** Saves rows as a CSV file from the browser: exactly what is on screen, in the order shown. */
export function downloadCsv(fileName: string, headers: readonly string[], rows: readonly (readonly CsvCell[])[]): void {
  const text = toCsv(headers, rows);
  const blob = new Blob([text.startsWith('﻿') ? text : `﻿${text}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName.replace(/[^A-Za-z0-9._-]+/g, '-');
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}
