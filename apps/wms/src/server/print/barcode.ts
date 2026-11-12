/**
 * Barcode rendering (bwip-js) for PDF printouts. ZPL output uses the printer's native
 * barcode commands instead (see `zpl.ts`).
 */
import { toBuffer } from 'bwip-js/node';
import { AppError } from '@/server/api/errors';

export const BARCODE_TYPES = ['code128', 'qrcode', 'datamatrix', 'gs1-128'] as const;
export type BarcodeType = (typeof BARCODE_TYPES)[number];

export interface BarcodeOptions {
  readonly type?: BarcodeType;
  readonly text: string;
  /** Bar height in millimetres (linear codes). */
  readonly heightMm?: number;
  readonly scale?: number;
  /** Print the human-readable text under the bars (linear codes). */
  readonly includeText?: boolean;
}

const MAX_BARCODE_TEXT = 200;

/** PNG bytes for a barcode. Invalid data is reported as a VALIDATION error. */
export async function renderBarcodePng(options: BarcodeOptions): Promise<Buffer> {
  const type = options.type ?? 'code128';
  const text = options.text.trim();
  if (text.length === 0) throw new AppError('VALIDATION', 'Barcode value is empty');
  if (text.length > MAX_BARCODE_TEXT) throw new AppError('VALIDATION', 'Barcode value is too long');
  const linear = type === 'code128' || type === 'gs1-128';
  try {
    return await toBuffer({
      bcid: type,
      text,
      scale: options.scale ?? 3,
      ...(linear
        ? { height: options.heightMm ?? 12, includetext: options.includeText ?? false, textxalign: 'center' }
        : {}),
    });
  } catch (error: unknown) {
    throw new AppError('VALIDATION', `Cannot encode "${text}" as ${type}`, { cause: error });
  }
}
