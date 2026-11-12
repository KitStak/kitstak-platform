/**
 * MIME sniffing from magic bytes (BUILD_PLAN F6 `files.ts`).
 *
 * The declared content type of an upload is never trusted: the stored `mime` is derived
 * from the leading bytes, with the file extension used only to disambiguate containers
 * (an `.xlsx` is a ZIP) and plain-text formats (CSV, ZPL).
 */

export const MIME = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip',
  csv: 'text/csv',
  zpl: 'application/x-zpl',
  text: 'text/plain',
  binary: 'application/octet-stream',
} as const;

export type KnownMime = (typeof MIME)[keyof typeof MIME];

const TEXT_SAMPLE_BYTES = 4096;

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function extensionOf(fileName: string | undefined): string {
  if (!fileName) return '';
  const dot = fileName.lastIndexOf('.');
  return dot < 0 ? '' : fileName.slice(dot + 1).toLowerCase();
}

/** True when the sample has no NUL bytes and decodes as UTF-8. */
export function looksLikeText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, TEXT_SAMPLE_BYTES);
  // Control bytes other than tab, LF, FF and CR mean binary content.
  if (sample.some((byte) => byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0c && byte !== 0x0d))
    return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(sample);
    return true;
  } catch {
    // A multi-byte sequence may be cut at the sample boundary; retry without the tail.
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(sample.subarray(0, Math.max(0, sample.length - 3)));
      return sample.length > 3;
    } catch {
      return false;
    }
  }
}

function sniffText(bytes: Uint8Array, ext: string): KnownMime {
  const head = new TextDecoder('utf-8').decode(bytes.subarray(0, 64)).replace(/^﻿/, '').trimStart();
  if (head.startsWith('^XA') || ext === 'zpl') return MIME.zpl;
  if (ext === 'csv' || ext === 'tsv') return MIME.csv;
  return MIME.text;
}

/** Detects the MIME type of `bytes`. `fileName` only disambiguates ZIP containers and text. */
export function sniffMime(bytes: Uint8Array, fileName?: string): KnownMime {
  const ext = extensionOf(fileName);
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return MIME.pdf; // %PDF-
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return MIME.png;
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return MIME.jpeg;
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return MIME.gif; // GIF8
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8))
    return MIME.webp;
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return ext === 'xlsx' ? MIME.xlsx : MIME.zip;
  if (bytes.length > 0 && looksLikeText(bytes)) return sniffText(bytes, ext);
  return MIME.binary;
}

const EXTENSIONS: Readonly<Record<string, string>> = {
  [MIME.pdf]: 'pdf',
  [MIME.png]: 'png',
  [MIME.jpeg]: 'jpg',
  [MIME.gif]: 'gif',
  [MIME.webp]: 'webp',
  [MIME.xlsx]: 'xlsx',
  [MIME.zip]: 'zip',
  [MIME.csv]: 'csv',
  [MIME.zpl]: 'zpl',
  [MIME.text]: 'txt',
};

/** Canonical file extension for a MIME type (`bin` when unknown). */
export function extensionForMime(mime: string): string {
  return EXTENSIONS[mime] ?? 'bin';
}
