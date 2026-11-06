/**
 * Small public-to-members image assets (profile photos, organization logos). Stored on local
 * disk under `UPLOAD_DIR/assets/<uuid>.<ext>`; the id is server-generated, so user input never
 * reaches the filesystem. Content is verified by magic bytes, not by the declared MIME type.
 */
import 'server-only';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '@/server/env';
import { BadRequestError, NotFoundError, PayloadTooLargeError } from '@/server/http/errors';
import type { UploadedAssetDto } from './admin-contracts';

export const ASSET_MAX_BYTES = 2 * 1024 * 1024;

const TYPES = {
  png: { mime: 'image/png', sniff: (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  jpg: { mime: 'image/jpeg', sniff: (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  gif: { mime: 'image/gif', sniff: (b: Uint8Array) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 },
  webp: {
    mime: 'image/webp',
    sniff: (b: Uint8Array) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45,
  },
} as const;
type Ext = keyof typeof TYPES;

export const ASSET_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|gif|webp)$/;

function assetDir(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), env.UPLOAD_DIR, 'assets');
}

export function detectImage(bytes: Uint8Array): Ext | null {
  for (const [ext, type] of Object.entries(TYPES) as [Ext, (typeof TYPES)[Ext]][]) {
    if (type.sniff(bytes)) return ext;
  }
  return null;
}

export async function saveImageAsset(file: File): Promise<UploadedAssetDto> {
  if (file.size === 0) throw new BadRequestError('The file is empty');
  if (file.size > ASSET_MAX_BYTES) throw new PayloadTooLargeError(ASSET_MAX_BYTES);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = detectImage(bytes);
  if (!ext) throw new BadRequestError('Upload a PNG, JPG, GIF or WebP image');
  const id = `${randomUUID()}.${ext}`;
  const dir = assetDir();
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, id), bytes, { flag: 'wx' });
  return { url: `/api/v1/assets/${id}`, mime: TYPES[ext].mime, size: bytes.byteLength };
}

export async function readImageAsset(id: string): Promise<{ body: Uint8Array; mime: string }> {
  if (!ASSET_ID_RE.test(id)) throw new NotFoundError('Asset');
  const ext = id.slice(id.lastIndexOf('.') + 1) as Ext;
  try {
    const body = await readFile(path.join(assetDir(), id));
    return { body: new Uint8Array(body), mime: TYPES[ext].mime };
  } catch {
    throw new NotFoundError('Asset');
  }
}
