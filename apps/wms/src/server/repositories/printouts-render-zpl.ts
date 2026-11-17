/**
 * ZPL II output for designer label layouts (203 dpi), split out of `printouts-render.ts`.
 *
 * Orientation: ZPL has no command that turns a whole label a quarter turn (`^PO` only inverts
 * it 180 degrees, `^FW` only sets a default field rotation without moving anything). A
 * landscape stock such as 6x4 is therefore printed on 4x6 media fed short edge first:
 * `^PW` / `^LL` describe the fed label (4 in wide, 6 in long), every field is rotated a quarter
 * turn clockwise (`^A0R`, `^BCR`, …) and its origin is mapped from design coordinates by
 * `zplOrigin`. Portrait stocks take the unrotated path and print exactly as before.
 */
import {
  dots,
  zplBox,
  zplField,
  zplLabel,
  zplOrigin,
  zplSymbolSize,
  zplText,
  type ZplFrame,
  type ZplRotation,
} from '@/server/print/zpl';
import {
  blockIdOf,
  isLandscapeStock,
  isTwoDimensional,
  PAPER_POINTS,
  printDate,
  printFieldValue,
  type BarcodeSymbology,
  type PrintBlock,
  type PrintoutLayout,
  type PrintRecord,
} from '@/lib/grid-defs/admin/printouts';
import type { RenderOptions } from './printouts-render';

const qrMagnification = (moduleWidth: number): number => Math.max(2, moduleWidth + 2);
const dataMatrixModule = (moduleWidth: number): number => Math.max(3, moduleWidth * 2);

/**
 * Native ZPL barcode command for a symbology (Code 128 fallback for GS1 data without FNC1).
 * `^BQ` accepts no rotation, so a QR code stays upright; it scans in any orientation.
 */
function zplBarcode(
  sym: BarcodeSymbology,
  x: number,
  y: number,
  value: string,
  height: number,
  moduleWidth: number,
  rotation: ZplRotation = 'N',
): string {
  const data = `^FH\\^FD${zplField(value)}^FS`;
  const by = `^BY${moduleWidth}`;
  switch (sym) {
    case 'qrcode':
      return `^FO${x},${y}^BQN,2,${qrMagnification(moduleWidth)}^FH\\^FDQA,${zplField(value)}^FS`;
    case 'datamatrix':
      return `^FO${x},${y}^BX${rotation},${dataMatrixModule(moduleWidth)},200${data}`;
    case 'pdf417':
      return `^FO${x},${y}${by}^B7${rotation},${Math.max(4, Math.round(height / 12))},3,,,N${data}`;
    case 'code39':
      return `^FO${x},${y}${by}^B3${rotation},N,${height},N,N${data}`;
    case 'ean13':
      return `^FO${x},${y}${by}^BE${rotation},${height},N,N${data}`;
    case 'upca':
      return `^FO${x},${y}${by}^BU${rotation},${height},N,N,N${data}`;
    case 'gs1-128':
    case 'code128':
    default:
      return `^FO${x},${y}${by}^BC${rotation},${height},N,N,N${data}`;
  }
}

const blockFor = (layout: PrintoutLayout, key: string): PrintBlock | null => {
  const id = blockIdOf(key);
  return id === null ? null : (layout.blocks.find((b) => b.id === id) ?? null);
};

/**
 * ZPL II for label layouts, one `^XA…^XZ` per record. Sections and blocks print top to bottom
 * like the PDF; images are skipped (ZPL needs ^GF bitmaps) and noted in a comment.
 */
export function renderLayoutZpl(
  layout: PrintoutLayout,
  records: readonly PrintRecord[],
  opts: RenderOptions,
  copies = 1,
): string {
  const [pw, ph] = PAPER_POINTS[layout.paper];
  // Design size in dots. Layout below always works in design coordinates.
  const widthDots = dots(pw / 72);
  const lengthDots = dots(ph / 72);
  const frame: ZplFrame | undefined = isLandscapeStock(layout.paper)
    ? { rotation: 'R', printWidth: lengthDots }
    : undefined;
  const margin = dots(ph <= 72 ? 0.06 : 0.12);
  const inner = widthDots - margin * 2;
  const pt = (points: number) => Math.round((points / 72) * 203);
  const alignOf = (a: 'left' | 'center' | 'right') => (a === 'right' ? 'R' : a === 'center' ? 'C' : 'L');
  return records
    .map((record) => {
      const cmds: string[] = [];
      /** Adds a command; an empty one means the field fell outside a rotated label. */
      const put = (what: string, command: string): void => {
        cmds.push(command || `^FX ${what} not sent: it falls outside the label`);
      };
      /** Emits a barcode and returns the height it occupies in the design. */
      const barcode = (
        what: string,
        sym: BarcodeSymbology,
        x: number,
        y: number,
        value: string,
        height: number,
        moduleWidth: number,
      ): number => {
        const reserved = Math.min(height * 2, inner);
        const moduleDots = sym === 'qrcode' ? qrMagnification(moduleWidth) : dataMatrixModule(moduleWidth);
        const box = !isTwoDimensional(sym)
          ? height
          : frame
            ? (zplSymbolSize(sym, value, moduleDots) ?? reserved)
            : reserved;
        const origin = zplOrigin(frame, x, y, box);
        put(
          what,
          origin ? zplBarcode(sym, origin[0], origin[1], value, height, moduleWidth, frame?.rotation) : '',
        );
        return box;
      };
      let y = margin;
      for (const key of layout.sections.filter((sec) => sec.enabled).map((sec) => sec.key)) {
        const b = blockFor(layout, key);
        if (b) {
          const what = `block ${b.id}`;
          if (b.kind === 'spacer') y += pt(b.height);
          else if (b.kind === 'divider') {
            const thickness = Math.max(2, pt(Math.min(b.height, 6)));
            put(what, zplBox(margin, y, inner, thickness, thickness, frame));
            y += pt(Math.min(b.height, 6)) + 8;
          } else if (b.kind === 'text' || b.kind === 'field') {
            const h = pt(b.size);
            const value = b.kind === 'text' ? b.text : `${b.text}${printFieldValue(record, b.field, opts)}`;
            put(
              what,
              zplText({
                x: margin,
                y,
                text: value,
                height: h,
                blockWidth: inner,
                maxLines: 3,
                align: alignOf(b.align),
                frame,
              }),
            );
            y += Math.ceil((value.length * h * 0.55) / inner + 0.5) * (h + 4);
          } else if (b.kind === 'barcode') {
            const h = pt(b.height);
            const width = Math.round((inner * b.widthPct) / 100);
            const x =
              b.align === 'center'
                ? margin + Math.round((inner - width) / 2)
                : b.align === 'right'
                  ? margin + inner - width
                  : margin;
            y += barcode(what, b.symbology, x, y, printFieldValue(record, b.field, opts), h, 2) + 12;
          } else {
            cmds.push(`^FX image block ${b.id} not sent: images need a ^GF bitmap from the printer driver`);
          }
          continue;
        }
        const what = `section ${key}`;
        if (key === 'title' && layout.title) {
          const h = pt(Math.min(layout.fontSize + 4, ph <= 72 ? 6 : 18));
          put(what, zplText({ x: margin, y, text: layout.title, height: h, frame }));
          y += h + 8;
        } else if (key === 'barcode') {
          const h = Math.round(lengthDots * (ph <= 72 ? 0.35 : 0.3));
          y += barcode(what, layout.barcodeType, margin, y, record.code, h, ph <= 72 ? 1 : 3) + 10;
        } else if (key === 'code') {
          const h = pt(ph <= 72 ? 8 : ph <= 144 ? 12 : 20);
          put(
            what,
            zplText({ x: margin, y, text: record.code, height: h, blockWidth: inner, align: 'C', frame }),
          );
          y += h + 8;
        } else if (key === 'details') {
          for (const d of (record.details ?? []).slice(0, ph <= 72 ? 0 : ph <= 144 ? 1 : 5)) {
            const h = pt(layout.fontSize);
            put(what, zplText({ x: margin, y, text: d, height: h, frame }));
            y += h + 6;
          }
        } else if (key === 'footer' && ph > 144)
          put(
            what,
            zplText({
              x: margin,
              y: lengthDots - margin - 20,
              text: `Printed ${printDate(undefined, opts.now ?? new Date())} · ${opts.companyName}`,
              height: 18,
              frame,
            }),
          );
      }
      return frame
        ? zplLabel(lengthDots, widthDots, cmds, copies)
        : zplLabel(widthDots, lengthDots, cmds, copies);
    })
    .join('\n');
}
