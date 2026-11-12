/**
 * Shipping label output (4x6). Carrier labels stored by the carrier adapters are passed
 * through (PDF pages merged, ZPL concatenated, PNG placed on a 4x6 page). Without stored
 * label data a SANDBOX label is drawn, clearly marked as not valid for shipping.
 */
import { PDFDocument, rgb } from 'pdf-lib';
import { z } from 'zod';
import { AppError } from '@/server/api/errors';
import { renderBarcodePng } from '../barcode';
import { PAGE_LABEL_4X6, pdfSafe, PdfWriter } from '../pdf';
import {
  addressLines,
  addressSchema,
  pdfOutput,
  zplOutput,
  type PrintTemplate,
  type RenderContext,
} from '../types';
import { dots, zplBox, zplCode128, zplLabel, zplText } from '../zpl';

const MAX_LABEL_BASE64 = 8 * 1024 * 1024;

export const shippingLabelRecordSchema = z.object({
  trackingNumber: z.string().trim().min(1).max(60),
  carrier: z.string().trim().min(1).max(120),
  service: z.string().trim().max(120).default(''),
  shipFrom: addressSchema,
  shipTo: addressSchema,
  weightLb: z.number().nonnegative().optional(),
  orderCode: z.string().trim().max(60).optional(),
  packageNumber: z.string().trim().max(20).optional(),
  labelData: z
    .object({
      format: z.enum(['pdf', 'zpl', 'png']),
      base64: z
        .string()
        .min(1)
        .max(MAX_LABEL_BASE64)
        .regex(/^[A-Za-z0-9+/=\s]+$/, 'Invalid base64'),
    })
    .optional(),
});

export type ShippingLabelRecord = z.output<typeof shippingLabelRecordSchema>;

const decode = (base64: string): Buffer => Buffer.from(base64.replace(/\s+/g, ''), 'base64');

function sandboxZpl(record: ShippingLabelRecord, copies: number): string {
  const w = dots(4);
  const from = addressLines(record.shipFrom).slice(0, 4);
  const to = addressLines(record.shipTo).slice(0, 6);
  return zplLabel(
    w,
    dots(6),
    [
      zplText({
        x: 20,
        y: 20,
        text: 'SANDBOX - NOT A VALID SHIPPING LABEL',
        height: 26,
        blockWidth: w - 40,
        align: 'C',
      }),
      ...from.map((line, i) => zplText({ x: 20, y: 70 + i * 26, text: line, height: 22 })),
      zplBox(10, 190, w - 20, 2),
      zplText({ x: 20, y: 205, text: 'SHIP TO:', height: 24 }),
      ...to.map((line, i) => zplText({ x: 40, y: 240 + i * 36, text: line, height: 32 })),
      zplBox(10, 470, w - 20, 2),
      zplText({ x: 20, y: 485, text: `${record.carrier} ${record.service}`.trim(), height: 40 }),
      zplText({
        x: 20,
        y: 535,
        text: [
          record.orderCode,
          record.packageNumber && `PKG ${record.packageNumber}`,
          record.weightLb !== undefined && `${record.weightLb} LB`,
        ]
          .filter(Boolean)
          .join('   '),
        height: 24,
      }),
      zplCode128({ x: 50, y: 590, value: record.trackingNumber, height: 200, moduleWidth: 3 }),
    ],
    copies,
  );
}

async function drawSandboxPdf(
  out: PDFDocument,
  writer: PdfWriter,
  record: ShippingLabelRecord,
): Promise<void> {
  const page = writer.currentPage;
  page.drawRectangle({
    x: 8,
    y: PAGE_LABEL_4X6[1] - 30,
    width: PAGE_LABEL_4X6[0] - 16,
    height: 20,
    color: rgb(0.85, 0.1, 0.1),
  });
  page.drawText('SANDBOX - NOT A VALID SHIPPING LABEL', {
    x: 20,
    y: PAGE_LABEL_4X6[1] - 24,
    size: 9,
    font: writer.bold,
    color: rgb(1, 1, 1),
  });
  writer.moveDown(26);
  for (const line of addressLines(record.shipFrom).slice(0, 4)) writer.text(line, { size: 8 });
  writer.rule();
  writer.text('SHIP TO', { size: 8, bold: true });
  for (const line of addressLines(record.shipTo).slice(0, 6))
    writer.text(line, { size: 12, bold: true, x: writer.margin + 12 });
  writer.rule();
  writer.text(`${record.carrier} ${record.service}`.trim(), { size: 16, bold: true });
  writer.text(
    [
      record.orderCode,
      record.packageNumber && `PKG ${record.packageNumber}`,
      record.weightLb !== undefined && `${record.weightLb} LB`,
    ]
      .filter(Boolean)
      .join('   '),
    { size: 9 },
  );
  const img = await out.embedPng(
    await renderBarcodePng({ text: record.trackingNumber, heightMm: 20, scale: 3 }),
  );
  const width = PAGE_LABEL_4X6[0] - writer.margin * 2;
  writer.moveDown(6);
  writer.image(img, width, Math.min(110, (img.height / img.width) * width));
  writer.text(pdfSafe(record.trackingNumber), { size: 10, align: 'center' });
}

async function appendStoredPdf(
  writer: PdfWriter,
  record: ShippingLabelRecord,
  base64: string,
): Promise<void> {
  let source: PDFDocument;
  try {
    source = await PDFDocument.load(decode(base64));
  } catch (error: unknown) {
    throw new AppError('VALIDATION', `Stored label for ${record.trackingNumber} is not a valid PDF`, {
      cause: error,
    });
  }
  const pages = await writer.doc.copyPages(source, source.getPageIndices());
  for (const page of pages) writer.doc.addPage(page);
}

function storedFormatMismatch(record: ShippingLabelRecord): never {
  throw new AppError(
    'VALIDATION',
    `Label ${record.trackingNumber} is stored as ${record.labelData?.format.toUpperCase()}; print it as ${record.labelData?.format === 'zpl' ? 'ZPL' : 'PDF'}`,
  );
}

async function renderPdf(records: readonly ShippingLabelRecord[], ctx: RenderContext): Promise<Uint8Array> {
  const writer = await PdfWriter.create(PAGE_LABEL_4X6, 12, ctx.typeName);
  writer.doc.removePage(0);
  for (const record of records) {
    for (let copy = 0; copy < ctx.options.copies; copy += 1) {
      const data = record.labelData;
      if (data?.format === 'zpl') storedFormatMismatch(record);
      if (data?.format === 'pdf') {
        await appendStoredPdf(writer, record, data.base64);
        continue;
      }
      writer.newPage();
      if (data?.format === 'png') {
        const img = await writer.doc.embedPng(decode(data.base64)).catch((error: unknown) => {
          throw new AppError('VALIDATION', `Stored label for ${record.trackingNumber} is not a valid PNG`, {
            cause: error,
          });
        });
        writer.currentPage.drawImage(img, {
          x: 0,
          y: 0,
          width: PAGE_LABEL_4X6[0],
          height: PAGE_LABEL_4X6[1],
        });
        continue;
      }
      await drawSandboxPdf(writer.doc, writer, record);
    }
  }
  return writer.doc.save();
}

export const shippingLabelTemplate: PrintTemplate<ShippingLabelRecord> = {
  recordSchema: shippingLabelRecordSchema,
  async render(records, ctx) {
    if (ctx.format === 'pdf') return pdfOutput(await renderPdf(records, ctx));
    const labels = records.map((record) => {
      const data = record.labelData;
      if (!data) return sandboxZpl(record, ctx.options.copies);
      if (data.format !== 'zpl') storedFormatMismatch(record);
      const zpl = decode(data.base64).toString('utf8').trim();
      return Array.from({ length: ctx.options.copies }, () => zpl).join('\n');
    });
    return zplOutput(labels.join('\n'));
  },
};
