/**
 * A small built in PDF writer for test gateway invoices (docs/billing/CONTRACTS.md section 10.4). No
 * dependency: one page, the standard Helvetica fonts, a few filled boxes and thin rules. Stripe makes
 * its own PDFs in the Stripe modes; this file is only for local and non production use.
 *
 * The page reads like the invoice screen in the Portal (SPEC 6.6), top to bottom:
 *   the KitStak mark from the email header, who sells and who buys, the date and what it is for,
 *   the same plan lines as the picker, then one sum: list price, discounts, subtotal, promo code or
 *   credit (once), tax, total, paid. `invoiceView` builds the lines for both, so they cannot differ.
 */
import { formatDay, formatMoney } from '../catalog';
import { type InvoiceSeller, invoiceSeller, invoiceTitle, invoiceView } from '../invoice-view';

export { type InvoiceSeller, invoiceSeller };
import { quoteSummaryLines } from '../quote';
import type { GatewayInvoice } from './types';

export interface InvoicePdfInput {
  readonly invoice: GatewayInvoice;
  readonly orgName: string;
  /** Lines under "Billed to": email, address, tax ID. */
  readonly billTo?: readonly string[];
  /** Defaults to `invoiceSeller(process.env)`. */
  readonly seller?: InvoiceSeller;
}

type Font = 'F1' | 'F2';
type Rgb = readonly [number, number, number];

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const LEFT = 56;
const RIGHT = PAGE_WIDTH - 56;
/** The second column of the two column blocks, and the label edge of the totals. */
const MID = 326;

/** The colors of the email header and the Portal's light theme. */
const hex = (value: string): Rgb => [
  parseInt(value.slice(1, 3), 16) / 255,
  parseInt(value.slice(3, 5), 16) / 255,
  parseInt(value.slice(5, 7), 16) / 255,
];
const INK = hex('#0a1628');
const BODY = hex('#3c4659');
const MUTED = hex('#566072');
const RULE = hex('#dcd6c8');
const RULE_SOFT = hex('#e9e4d8');
const RED = hex('#c8102e');
const OXBLOOD = hex('#8f122c');
const GREEN = hex('#1a6b45');

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

/**
 * The width of a money string in Helvetica or Helvetica Bold. Digits and "$" are 556 units wide in
 * both, "." and "," are 278 and "-" is 333 (the Adobe font metrics), so right aligning is exact.
 */
function moneyWidth(text: string, size: number): number {
  let units = 0;
  for (const char of text) units += char === '.' || char === ',' ? 278 : char === '-' ? 333 : 556;
  return (units / 1000) * size;
}

/** Breaks a long line at spaces. Helvetica averages about half its size per letter. */
function wrap(text: string, width: number, size: number, maxLines = 2): string[] {
  const perLine = Math.max(8, Math.floor(width / (size * 0.52)));
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= perLine) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word.length > perLine ? `${word.slice(0, perLine - 3)}...` : word;
  }
  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  const last = kept[maxLines - 1] ?? '';
  kept[maxLines - 1] = `${last.slice(0, Math.max(0, perLine - 3))}...`;
  return kept;
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
  const seller = input.seller ?? invoiceSeller(process.env);
  const view = invoiceView(invoice);
  const ops: string[] = [];
  const num = (value: number) => value.toFixed(2);
  const fill = (color: Rgb) => `${color.map((part) => part.toFixed(3)).join(' ')} rg`;

  const text = (value: string, x: number, y: number, options?: { font?: Font; size?: number; color?: Rgb; spacing?: number }) => {
    const size = options?.size ?? 10.5;
    ops.push(
      `BT /${options?.font ?? 'F1'} ${size} Tf ${fill(options?.color ?? INK)} ${num(options?.spacing ?? 0)} Tc ${num(x)} ${num(y)} Td (${escapePdf(value)}) Tj ET`,
    );
  };
  const money = (cents: number, y: number, options?: { font?: Font; size?: number; color?: Rgb }) => {
    const value = formatMoney(cents);
    const size = options?.size ?? 10.5;
    text(value, RIGHT - moneyWidth(value, size), y, { ...options, size });
  };
  const box = (x: number, y: number, width: number, height: number, color: Rgb) => {
    ops.push(`${fill(color)} ${num(x)} ${num(y)} ${num(width)} ${num(height)} re f`);
  };
  const rule = (y: number, from = LEFT, color: Rgb = RULE) => box(from, y, RIGHT - from, 0.75, color);
  const eyebrow = (value: string, x: number, y: number) => text(value.toUpperCase(), x, y, { font: 'F2', size: 7.5, color: MUTED, spacing: 0.9 });

  /* The mark from the email header: a red bar over an oxblood bar, then the word. */
  let y = PAGE_HEIGHT - 62;
  box(LEFT, y + 9, 26, 6, RED);
  box(LEFT, y - 1, 26, 6, OXBLOOD);
  text('KITSTAK', LEFT + 36, y + 1.5, { font: 'F2', size: 15, spacing: 2.6 });

  y -= 46;
  text(`Invoice ${invoice.number ?? invoice.id}`, LEFT, y, { font: 'F2', size: 20 });
  y -= 19;
  text(statusWords(invoice), LEFT, y, { size: 10.5, color: BODY });
  y -= 14;
  text('Test mode. No real money moved.', LEFT, y, { size: 9, color: MUTED });
  y -= 18;
  rule(y);

  /* Who sells and who buys. */
  y -= 24;
  eyebrow('From', LEFT, y);
  eyebrow('Billed to', MID, y);
  const columnWidth = MID - LEFT - 24;
  const column = (x: number, title: string, lines: readonly string[]): number => {
    let at = y - 16;
    for (const part of wrap(title, columnWidth, 11)) {
      text(part, x, at, { font: 'F2', size: 11 });
      at -= 14;
    }
    for (const line of lines.slice(0, 7)) {
      for (const part of wrap(line, columnWidth, 9.5)) {
        text(part, x, at, { size: 9.5, color: MUTED });
        at -= 13;
      }
    }
    return at;
  };
  const sellerLines = [...seller.address, ...(seller.taxId ? [`Tax ID: ${seller.taxId}`] : []), seller.site];
  y = Math.min(column(LEFT, seller.name, sellerLines), column(MID, input.orgName, input.billTo ?? [])) - 12;

  /* When, and what for. */
  eyebrow('Date', LEFT, y);
  eyebrow('For', MID, y);
  text(formatDay(invoice.issuedAt), LEFT, y - 16, { font: 'F2', size: 11 });
  text(invoiceTitle(invoice), MID, y - 16, { font: 'F2', size: 11 });
  if (invoice.periodStart && invoice.periodEnd) {
    text(`${formatDay(invoice.periodStart)} to ${formatDay(invoice.periodEnd)}`, MID, y - 30, { size: 9.5, color: MUTED });
  }
  y -= 48;
  rule(y);

  /* The lines. A plan invoice repeats the picker: one math line per app at its list price. */
  y -= 24;
  if (view.quote) {
    eyebrow('Your plan', LEFT, y);
    y -= 18;
    for (const line of view.quote.lines) {
      text(line.math, LEFT, y);
      y -= 16;
    }
  } else {
    eyebrow('What it was for', LEFT, y);
    text('AMOUNT', RIGHT - 39, y, { font: 'F2', size: 7.5, color: MUTED, spacing: 0.9 });
    y -= 18;
    for (const line of view.rawLines.slice(0, 18)) {
      const [first = ''] = wrap(line.description, RIGHT - LEFT - 90, 10.5, 1);
      text(first, LEFT, y);
      money(line.amountCents, y);
      y -= 16;
    }
  }
  y -= 2;
  rule(y, LEFT, RULE_SOFT);

  /* One sum, top to bottom. Every row is printed once, and each total is the rows above it. */
  y -= 22;
  const row = (label: string, cents: number, options?: { bold?: boolean; color?: Rgb; size?: number }) => {
    const font: Font = options?.bold ? 'F2' : 'F1';
    const [first = ''] = wrap(label, RIGHT - MID - 70, 10.5, 1);
    text(first, MID, y, { font, size: options?.size ?? 10.5, color: options?.bold ? INK : BODY });
    money(cents, y, { font, size: options?.size ?? 10.5, color: options?.color ?? INK });
    y -= 17;
  };
  const thin = () => {
    rule(y + 9, MID, RULE_SOFT);
    y -= 8;
  };
  const summary = view.quote ? quoteSummaryLines(view.quote).filter((entry) => entry.kind !== 'total') : [];
  for (const entry of summary) row(entry.label, entry.amountCents, { color: entry.amountCents < 0 ? GREEN : INK });
  if (summary.length > 0) thin();
  row('Subtotal', view.subtotalCents, { bold: true });
  for (const entry of view.adjustments) row(entry.label, entry.amountCents, { color: GREEN });
  row('Sales tax', invoice.taxCents);
  thin();
  row('Total', invoice.totalCents, { bold: true, size: 12 });
  row('Paid', invoice.amountPaidCents);
  if (invoice.refundedCents > 0) row('Sent back to your card', invoice.refundedCents);
  if (invoice.amountDueCents > 0) row('Still due', invoice.amountDueCents, { bold: true });

  y -= 4;
  rule(y);
  y -= 22;
  if (invoice.status === 'paid' && invoice.paymentMethodLast4) {
    const when = invoice.paidAt ? `Paid on ${formatDay(invoice.paidAt)}` : 'Paid';
    text(`${when} with the card ending ${invoice.paymentMethodLast4}.`, LEFT, y, { color: BODY });
  } else if (invoice.status === 'paid') {
    text(invoice.paidAt ? `Paid on ${formatDay(invoice.paidAt)}.` : 'Paid.', LEFT, y, { color: BODY });
  } else if (invoice.status === 'open') {
    text('This invoice is not paid yet. Pay it in Billing in the Portal.', LEFT, y, { color: BODY });
  }

  /* The foot of the page: who sent it. */
  rule(64, LEFT, RULE_SOFT);
  text(`${seller.name} \u00b7 ${seller.site}`, LEFT, 48, { size: 9, color: MUTED });

  const stream = ops.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
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
