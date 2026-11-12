/**
 * Picking lists (order, job and work order; standard and consolidated). Lines are sorted
 * in walking order (location code). The consolidated variants merge lines with the same
 * location + SKU + lot + LP and list the contributing orders.
 */
import { z } from 'zod';
import { renderBarcodePng } from '../barcode';
import { PdfWriter, type TableColumn } from '../pdf';
import { formatPrintDate, pdfOutput, type PrintTemplate } from '../types';

const pickLineSchema = z.object({
  locationCode: z.string().trim().min(1).max(120),
  sku: z.string().trim().min(1).max(120),
  name: z.string().trim().max(300).default(''),
  quantity: z.number().int().positive(),
  uom: z.string().trim().max(40).optional(),
  lpNumber: z.string().trim().max(120).optional(),
  lotNumber: z.string().trim().max(120).optional(),
  expiryDate: z.string().max(40).optional(),
  orderCode: z.string().trim().max(60).optional(),
  walkingPathPriority: z.number().int().optional(),
});

export const pickListRecordSchema = z.object({
  code: z.string().trim().min(1).max(60),
  warehouseName: z.string().trim().max(200).optional(),
  jobType: z.string().trim().max(120).optional(),
  assignee: z.string().trim().max(200).optional(),
  createdAt: z.string().max(40).optional(),
  orderCount: z.number().int().nonnegative().optional(),
  lines: z.array(pickLineSchema).min(1).max(5000),
});

export type PickListRecord = z.output<typeof pickListRecordSchema>;
export type PickLine = PickListRecord['lines'][number];

export interface ConsolidatedLine extends PickLine {
  readonly orders: readonly string[];
}

/** Walking order: walking-path priority when given, then location code, then SKU. */
export function sortPickLines<L extends PickLine>(lines: readonly L[]): L[] {
  return [...lines].sort(
    (a, b) =>
      (a.walkingPathPriority ?? Number.MAX_SAFE_INTEGER) -
        (b.walkingPathPriority ?? Number.MAX_SAFE_INTEGER) ||
      a.locationCode.localeCompare(b.locationCode, 'en', { numeric: true }) ||
      a.sku.localeCompare(b.sku),
  );
}

export function consolidatePickLines(lines: readonly PickLine[]): ConsolidatedLine[] {
  const groups = new Map<string, ConsolidatedLine>();
  for (const line of lines) {
    const key = [line.locationCode, line.sku, line.lotNumber ?? '', line.lpNumber ?? ''].join('\u0000');
    const existing = groups.get(key);
    const orders = line.orderCode ? [line.orderCode] : [];
    groups.set(
      key,
      existing
        ? {
            ...existing,
            quantity: existing.quantity + line.quantity,
            orders: [...new Set([...existing.orders, ...orders])],
          }
        : { ...line, orders },
    );
  }
  return sortPickLines([...groups.values()]);
}

const check = (): string => '[  ]';

const STANDARD: readonly TableColumn<ConsolidatedLine>[] = [
  { label: 'Location', width: 0.16, value: (l) => l.locationCode },
  { label: 'SKU', width: 0.17, value: (l) => l.sku },
  { label: 'Description', width: 0.25, value: (l) => l.name },
  { label: 'LP / Lot', width: 0.16, value: (l) => [l.lpNumber, l.lotNumber].filter(Boolean).join(' / ') },
  { label: 'Order', width: 0.12, value: (l) => l.orders.join(', ') },
  { label: 'Qty', width: 0.07, align: 'right', value: (l) => String(l.quantity) },
  { label: 'Picked', width: 0.07, value: check },
];

async function renderList(
  writer: PdfWriter,
  record: PickListRecord,
  title: string,
  consolidated: boolean,
): Promise<void> {
  const top = writer.y;
  writer.text(title, { size: 18, bold: true });
  writer.text(record.warehouseName ?? '', { size: 10, muted: true });
  const img = await writer.doc.embedPng(
    await renderBarcodePng({ text: record.code, heightMm: 10, scale: 2 }),
  );
  const width = 160;
  const height = (img.height / img.width) * width;
  writer.currentPage.drawImage(img, {
    x: writer.size[0] - writer.margin - width,
    y: top - height,
    width,
    height,
  });
  writer.moveDown(Math.max(0, height - (top - writer.y)) + 6);

  const lines: ConsolidatedLine[] = consolidated
    ? consolidatePickLines(record.lines)
    : sortPickLines(record.lines.map((l) => ({ ...l, orders: l.orderCode ? [l.orderCode] : [] })));
  writer.keyValues([
    ['Code', record.code],
    ['Job Type', record.jobType ?? '-'],
    ['Assigned To', record.assignee ?? 'Unassigned'],
    ['Created', formatPrintDate(record.createdAt) || '-'],
    [
      'Orders',
      String(record.orderCount ?? new Set(record.lines.map((l) => l.orderCode).filter(Boolean)).size),
    ],
    ['Units', String(lines.reduce((sum, l) => sum + l.quantity, 0))],
  ]);
  writer.moveDown(6);
  writer.table(STANDARD, lines);
  writer.moveDown(18);
  writer.text('Picked by: ____________________     Date: ____________     Checked by: ____________________', {
    size: 9,
    muted: true,
  });
}

export function createPickListTemplate(
  consolidatedTypes: ReadonlySet<string>,
): PrintTemplate<PickListRecord> {
  return {
    recordSchema: pickListRecordSchema,
    async render(records, ctx) {
      const writer = await PdfWriter.create(undefined, 36, `${ctx.typeName} ${records[0]?.code ?? ''}`);
      const consolidated = consolidatedTypes.has(ctx.typeKey);
      for (const [index, record] of records.entries()) {
        for (let copy = 0; copy < ctx.options.copies; copy += 1) {
          if (index > 0 || copy > 0) writer.newPage();
          await renderList(writer, record, ctx.typeName, consolidated);
        }
      }
      return pdfOutput(await writer.finish(`Printed ${formatPrintDate(ctx.now)}`));
    },
  };
}

export const pickListTemplate = createPickListTemplate(
  new Set(['consolidated-picking-list', 'work-order-consolidated-picking-list']),
);
