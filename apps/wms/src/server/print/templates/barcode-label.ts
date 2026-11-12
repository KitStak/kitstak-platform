/**
 * Barcode labels: LP, location, product and mobile cart labels. 4x2 in by default (4x6
 * with `labelSize: "4x6"`), PDF (bwip-js Code 128 image) or ZPL (native ^BC).
 */
import { z } from 'zod';
import { renderBarcodePng } from '../barcode';
import { PAGE_LABEL_4X2, PAGE_LABEL_4X6, pdfSafe, PdfWriter } from '../pdf';
import { pdfOutput, zplOutput, type PrintTemplate, type RenderContext } from '../types';
import { dots, zplCode128, zplLabel, zplText } from '../zpl';

export interface LabelSpec {
  readonly barcode: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly details: readonly string[];
}

const code = (max = 120) => z.string().trim().min(1).max(max);
const opt = (max = 200) => z.string().trim().max(max).optional();

export const lpLabelSchema = z.object({
  number: code(),
  lpType: opt(),
  warehouseCode: opt(),
  locationCode: opt(),
  clientName: opt(),
});
export const locationLabelSchema = z.object({
  code: code(),
  barcode: opt(120),
  warehouseCode: opt(),
  zone: opt(),
  aisle: opt(),
  level: opt(),
  locationType: opt(),
});
export const productLabelSchema = z.object({
  sku: code(),
  barcode: code(),
  name: z.string().trim().max(300).default(''),
  clientCode: opt(),
  packType: opt(),
  lotNumber: opt(),
});
export const mobileCartLabelSchema = z.object({ code: code(), name: opt(), cartType: opt() });

const join = (parts: readonly (string | undefined)[], sep = ' | '): string =>
  parts.filter((p) => p && p.length > 0).join(sep);

export const toLpSpec = (r: z.output<typeof lpLabelSchema>): LabelSpec => ({
  barcode: r.number,
  title: r.number,
  subtitle: r.lpType,
  details: [join([r.warehouseCode, r.locationCode]), r.clientName ?? ''].filter(Boolean),
});
export const toLocationSpec = (r: z.output<typeof locationLabelSchema>): LabelSpec => ({
  barcode: r.barcode ?? r.code,
  title: r.code,
  subtitle: r.locationType,
  details: [
    join([
      r.warehouseCode,
      r.zone && `Zone ${r.zone}`,
      r.aisle && `Aisle ${r.aisle}`,
      r.level && `Level ${r.level}`,
    ]),
  ].filter(Boolean),
});
export const toProductSpec = (r: z.output<typeof productLabelSchema>): LabelSpec => ({
  barcode: r.barcode,
  title: r.sku,
  subtitle: r.name,
  details: [join([r.clientCode, r.packType, r.lotNumber && `Lot ${r.lotNumber}`])].filter(Boolean),
});
export const toMobileCartSpec = (r: z.output<typeof mobileCartLabelSchema>): LabelSpec => ({
  barcode: r.code,
  title: r.code,
  subtitle: r.name,
  details: r.cartType ? [r.cartType] : [],
});

function stock(ctx: RenderContext): {
  readonly page: readonly [number, number];
  readonly inches: readonly [number, number];
} {
  return ctx.options.labelSize === '4x6'
    ? { page: PAGE_LABEL_4X6, inches: [4, 6] }
    : { page: PAGE_LABEL_4X2, inches: [4, 2] };
}

export function labelZpl(spec: LabelSpec, ctx: RenderContext): string {
  const { inches } = stock(ctx);
  const width = dots(inches[0]);
  const tall = inches[1] >= 6;
  const pad = 24;
  const commands = [
    zplText({
      x: pad,
      y: pad,
      text: spec.title,
      height: tall ? 70 : 44,
      blockWidth: width - pad * 2,
      align: 'C',
    }),
    ...(spec.subtitle
      ? [
          zplText({
            x: pad,
            y: pad + (tall ? 84 : 52),
            text: spec.subtitle,
            height: 26,
            blockWidth: width - pad * 2,
            maxLines: 2,
            align: 'C',
          }),
        ]
      : []),
    zplCode128({
      x: pad + 20,
      y: tall ? 260 : 130,
      value: spec.barcode,
      height: tall ? 220 : 120,
      moduleWidth: spec.barcode.length > 16 ? 2 : 3,
    }),
    ...spec.details.map((line, i) =>
      zplText({
        x: pad,
        y: (tall ? 560 : 300) + i * 30,
        text: line,
        height: 24,
        blockWidth: width - pad * 2,
        align: 'C',
      }),
    ),
  ];
  return zplLabel(width, dots(inches[1]), commands, ctx.options.copies);
}

async function drawPdfLabel(writer: PdfWriter, spec: LabelSpec, first: boolean): Promise<void> {
  if (!first) writer.newPage();
  const [pageWidth, pageHeight] = writer.size;
  const tall = pageHeight > 300;
  writer.text(spec.title, { size: tall ? 26 : 16, bold: true, align: 'center' });
  if (spec.subtitle) writer.text(spec.subtitle, { size: tall ? 12 : 8, align: 'center', muted: true });
  const png = await renderBarcodePng({ text: spec.barcode, heightMm: tall ? 22 : 9, scale: 3 });
  const img = await writer.doc.embedPng(png);
  const maxWidth = pageWidth - writer.margin * 2;
  const width = Math.min(maxWidth, img.width * 0.5);
  const height = (img.height / img.width) * width;
  writer.moveDown(tall ? 10 : 2);
  writer.image(img, width, height, (pageWidth - width) / 2);
  writer.text(pdfSafe(spec.barcode), { size: tall ? 11 : 7, align: 'center' });
  for (const line of spec.details) writer.text(line, { size: tall ? 10 : 7, align: 'center', muted: true });
}

export function createBarcodeLabelTemplate<R>(
  schema: z.ZodType<R>,
  toSpec: (record: R) => LabelSpec,
): PrintTemplate<R> {
  return {
    recordSchema: schema,
    async render(records, ctx) {
      const specs = records.map(toSpec);
      if (ctx.format === 'zpl') return zplOutput(specs.map((spec) => labelZpl(spec, ctx)).join('\n'));
      const writer = await PdfWriter.create(stock(ctx).page, 10, ctx.typeName);
      let first = true;
      for (const spec of specs) {
        for (let copy = 0; copy < ctx.options.copies; copy += 1) {
          await drawPdfLabel(writer, spec, first);
          first = false;
        }
      }
      return pdfOutput(await writer.doc.save());
    },
  };
}

export const lpLabelTemplate = createBarcodeLabelTemplate(lpLabelSchema, toLpSpec);
export const locationLabelTemplate = createBarcodeLabelTemplate(locationLabelSchema, toLocationSpec);
export const productLabelTemplate = createBarcodeLabelTemplate(productLabelSchema, toProductSpec);
export const mobileCartLabelTemplate = createBarcodeLabelTemplate(mobileCartLabelSchema, toMobileCartSpec);

/**
 * Retailer labels (Logiwa "Retailer Label For Case" / "Retailer Label For Parent LP"): one label per
 * case, barcode = order code (or the case/LP number when given). Only `orderCode` is required, so a
 * bulk menu can send just the code; the packing station fills retailer, PO, ship-to and case n/N.
 */
export const retailerLabelSchema = z.object({
  orderCode: code(),
  retailerName: opt(),
  storeOrderNumber: opt(),
  retailerPo: opt(),
  dept: opt(),
  markFor: opt(),
  shipTo: opt(300),
  clientName: opt(),
  caseNumber: z.number().int().min(1).optional(),
  caseCount: z.number().int().min(1).optional(),
  lpNumber: opt(),
});
export const toRetailerSpec = (r: z.output<typeof retailerLabelSchema>): LabelSpec => ({
  barcode: r.lpNumber ?? r.orderCode,
  title: r.retailerName ?? r.orderCode,
  subtitle:
    join([
      r.retailerPo && `PO ${r.retailerPo}`,
      r.dept && `Dept ${r.dept}`,
      r.markFor && `Mark for ${r.markFor}`,
    ]) || undefined,
  details: [
    join([r.orderCode, r.storeOrderNumber]),
    r.shipTo ?? '',
    join([r.clientName, r.caseNumber && r.caseCount ? `Case ${r.caseNumber} of ${r.caseCount}` : undefined]),
  ].filter(Boolean),
});
export const retailerLabelTemplate = createBarcodeLabelTemplate(retailerLabelSchema, toRetailerSpec);
