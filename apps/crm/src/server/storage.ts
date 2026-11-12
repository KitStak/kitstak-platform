/**
 * Object storage for uploaded bytes (file attachments, admin image assets).
 *
 * Two backends behind one interface:
 *   - local disk under `UPLOAD_DIR` (development, self-hosting)
 *   - a private Vercel Blob store, selected when its credentials are present. Serverless
 *     hosts have a read-only, per-instance filesystem, so disk storage cannot work there.
 *
 * Keys are server-generated relative paths (`<org>/<uuid>`, `assets/<uuid>.<ext>`). Callers
 * validate their own key shape; this module only guarantees a key cannot escape the root.
 * Blobs stay private: bytes are always served through the app's own authorised routes.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { del, get, put } from '@vercel/blob';
import { env } from '@/server/env';

export interface ObjectStore {
  /** Store bytes under a new key. Rejects if the key already exists. */
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** Read the bytes for a key, or `null` when nothing is stored there. */
  get(key: string): Promise<Uint8Array | null>;
  /** Remove a key. A missing key is not an error. */
  delete(key: string): Promise<void>;
}

const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

function assertKey(key: string): void {
  if (!KEY_RE.test(key) || key.includes('..')) throw new Error('Invalid storage key');
}

/** Resolve a key to an absolute path inside `root`, refusing anything that escapes it. */
export function localObjectPath(root: string, key: string): string {
  assertKey(key);
  const resolved = path.resolve(/*turbopackIgnore: true*/ root, key);
  if (!resolved.startsWith(root + path.sep)) throw new Error('Invalid storage key');
  return resolved;
}

export function createLocalStore(root: string): ObjectStore {
  return {
    async put(key, bytes) {
      const target = localObjectPath(root, key);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes, { flag: 'wx' });
    },
    async get(key) {
      try {
        return new Uint8Array(await readFile(localObjectPath(root, key)));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    async delete(key) {
      await rm(localObjectPath(root, key), { force: true });
    },
  };
}

export function createBlobStore(): ObjectStore {
  return {
    async put(key, bytes, contentType) {
      assertKey(key);
      await put(key, Buffer.from(bytes), {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType,
      });
    },
    async get(key) {
      assertKey(key);
      const result = await get(key, { access: 'private', useCache: false });
      if (!result || result.statusCode !== 200) return null;
      return new Uint8Array(await new Response(result.stream).arrayBuffer());
    },
    async delete(key) {
      assertKey(key);
      await del(key);
    },
  };
}

/** Absolute local upload root (runtime-configured, so the bundler must not trace it). */
export function uploadRoot(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), env.UPLOAD_DIR);
}

let store: ObjectStore | undefined;

/** The store for this process: Vercel Blob when configured, otherwise local disk. */
export function objectStore(): ObjectStore {
  store ??=
    env.BLOB_READ_WRITE_TOKEN || env.BLOB_STORE_ID ? createBlobStore() : createLocalStore(uploadRoot());
  return store;
}
