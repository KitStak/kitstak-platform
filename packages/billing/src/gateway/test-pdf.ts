/**
 * A tiny built in PDF writer for test gateway invoices (docs/billing/CONTRACTS.md section 10.4). No
 * dependency: one page, the standard Helvetica and Courier fonts, plain text. Stripe makes its own
 * PDFs in the Stripe modes; this file is only for local and non production use.
 */
import { formatDay, formatMoney } from '../catalog';
import type { GatewayInvoice } from './types';

export interface InvoicePdfInput {
  readonly invoice: GatewayInvoice;
  readonly orgName: string;
  /** Lines under "Bill to": email, address, tax ID. */
  readonly billTo?: readonly string[];
}

interface TextRun {
  readonly font: 'F1' | 'F2' | 'F3';
  readonly size: number;
  readonly x: number;
  readonly y: number;
  readonly text: string;
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const LEFT = 56;
const RIGHT = PAGE_WIDTH - 56;
/** Courier is fixed width: every glyph is 0.6 of the font size. That makes right aligning exact. */
const COURIER_ADVANCE = 0.6;

/** PDF standard fonts speak Latin 1. Anything else becomes a question mark. */
function latin1(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 63;
    out += code >= 32 && code <= 255 && code !== 127 ? char : '?';
  }
  return out;
}

function escapePdf(text: string): string {
  return latin1(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function statusWords(invoice: GatewayInvoice): string {
  switch (invoice.status) {
    case 'paid':
      return invoice.paidAt ? `Paid on ${formatDay(invoice.paidAt)}` : 'Paid';
    case 'open':
      return 'Due';
    case 'void':
      return 'Void';
    case 'uncollectible':
      return 'Not collected';
    default:
      return 'Draft';
  }
}

export function renderInvoicePdf(input: InvoicePdfInput): Uint8Array {
  const { invoice } = input;
  const runs: TextRun[] = [];
  let y = PAGE_HEIGHT - 64;
  const text = (value: string, options?: { font?: TextRun['font']; size?: number; x?: number }) => {
    runs.push({ font: options?.font ?? 'F1', size: options?.size ?? 11, x: options?.x ?? LEFT, y, text: value });
  };
  const amount = (cents: number, options?: { bold?: boolean }) => {
    const value = formatMoney(cents);
    const size = 11;
    runs.push({ font: 'F3', size, x: RIGHT - value.length * size * COURIER_ADVANCE, y, text: value });
    void options;
  };
  const down = (by: number) => {
    y -= by;
  };

  text('KitStak', { font: 'F2', size: 22 });
  down(26);
  text(`Invoice ${invoice.number ?? invoice.id}`, { font: 'F2', size: 14 });
  down(18);
  text('Test mode. No real money moved.', { size: 10 });
  down(26);

  text(`Date: ${formatDay(invoice.issuedAt)}`);
  down(16);
  text(`Status: ${statusWords(invoice)}`);
  down(16);
  if (invoice.periodStart && invoice.periodEnd) {
    text(`Period: ${formatDay(invoice.periodStart)} to ${formatDay(invoice.periodEnd)}`);
    down(16);
  }
  down(10);

  text('Bill to', { font: 'F2' });
  down(16);
  text(clip(input.orgName, 80));
  down(16);
  for (const line of input.billTo ?? []) {
    text(clip(line, 80));
    down(16);
  }
  down(14);

  text('What it was for', { font: 'F2' });
  runs.push({ font: 'F2', size: 11, x: RIGHT - 48, y, text: 'Amount' });
  down(18);
  for (const line of invoice.lines.slice(0, 24)) {
    text(clip(line.description, 70));
    amount(line.amountCents);
    down(16);
  }
  down(10);

  const total = (label: string, cents: number, bold = false) => {
    runs.push({ font: bold ? 'F2' : 'F1', size: 11, x: RIGHT - 240, y, text: label });
    amount(cents);
    down(16);
  };
  total('Subtotal', invoice.subtotalCents);
  if (invoice.discountCents > 0) total('Discount', -invoice.discountCents);
  total('Tax', invoice.taxCents);
  total('Total', invoice.totalCents, true);
  total('Paid', invoice.amountPaidCents);
  total('Still due', invoice.amountDueCents, true);
  if (invoice.paymentMethodLast4) {
    down(8);
    text(`Paid with the card ending ${invoice.paymentMethodLast4}.`);
    down(16);
  }

  const stream = runs
    .map((run) => `BT /${run.font} ${run.size} Tf ${run.x.toFixed(2)} ${run.y.toFixed(2)} Td (${escapePdf(run.text)}) Tj ET`)
    .join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 4 0 R /F2 5 0 R /F3 6 0 R >> >> /Contents 7 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
  ];

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefAt = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(body, 'latin1'));
}
