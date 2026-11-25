/**
 * Object storage for uploaded bytes (file attachments, admin image assets).
 *
 * Three backends behind one interface, picked in this order:
 *   - Supabase Storage (private `crm-files` bucket), when SUPABASE_URL and
 *     SUPABASE_SERVICE_ROLE_KEY are set. The preferred store: data and files with one provider.
 *   - a private Vercel Blob store, when its credentials are present.
 *   - local disk under `UPLOAD_DIR` (development, self-hosting). Serverless hosts have a
 *     read-only, per-instance filesystem, so on Vercel without either store, writes fail with a
 *     clear configuration error instead of an opaque EROFS.
 *
 * Keys are server-generated relative paths (`<org>/<uuid>`, `assets/<uuid>.<ext>`). Callers
 * validate their own key shape; this module only guarantees a key cannot escape the root.
 * Blobs stay private: bytes are always served through the app's own authorised routes.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { del, get, put } from '@vercel/blob';
import type { SupabaseClient } from '@supabase/supabase-js';
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

export const SUPABASE_FILES_BUCKET = 'crm-files';

/** The storage part of a Supabase client; narrowed so tests can pass a fake. */
export type SupabaseStorageApi = Pick<SupabaseClient['storage'], 'from' | 'createBucket'>;

/**
 * Supabase Storage adapter: a private bucket reached with the service-role key, server only.
 * Keys already start with the org id (`<org>/<uuid>`), so each workspace's files sit in their
 * own folder. Bytes are only ever served through the app's authorised routes.
 */
export function createSupabaseStore(
  storageApi: () => Promise<SupabaseStorageApi>,
  bucket: string = SUPABASE_FILES_BUCKET,
): ObjectStore {
  return {
    async put(key, bytes, contentType) {
      assertKey(key);
      const s = await storageApi();
      const upload = () => s.from(bucket).upload(key, bytes, { contentType, upsert: false });
      let { error } = await upload();
      if (error && /bucket not found/i.test(error.message)) {
        // First upload in a new project: make the bucket (private) and try once more.
        await s.createBucket(bucket, { public: false });
        ({ error } = await upload());
      }
      if (error) throw new Error(`The file could not be stored: ${error.message}`);
    },
    async get(key) {
      assertKey(key);
      const { data, error } = await (await storageApi()).from(bucket).download(key);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
    async delete(key) {
      assertKey(key);
      await (await storageApi()).from(bucket).remove([key]);
    },
  };
}

function supabaseStorageFromEnv(): () => Promise<SupabaseStorageApi> {
  let client: Promise<SupabaseStorageApi> | undefined;
  return () => {
    client ??= import('@supabase/supabase-js').then(
      ({ createClient }) =>
        createClient(env.SUPABASE_URL ?? '', env.SUPABASE_SERVICE_ROLE_KEY ?? '', {
          auth: { persistSession: false, autoRefreshToken: false },
        }).storage,
    );
    return client;
  };
}

/** A store that refuses writes with a clear message (serverless host, nothing configured). */
function unconfiguredStore(local: ObjectStore): ObjectStore {
  const fail = async (): Promise<never> => {
    throw new Error('File storage is not configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  };
  return { put: fail, get: (key) => local.get(key).catch(() => null), delete: async () => undefined };
}

/** Absolute local upload root (runtime-configured, so the bundler must not trace it). */
export function uploadRoot(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), env.UPLOAD_DIR);
}

let store: ObjectStore | undefined;

/** Which store this process uses, by the credentials present. */
export function storeKind(e: Partial<Record<string, string | undefined>>): 'supabase' | 'blob' | 'local' | 'unconfigured' {
  if (e.SUPABASE_URL?.trim() && e.SUPABASE_SERVICE_ROLE_KEY?.trim()) return 'supabase';
  if (e.BLOB_READ_WRITE_TOKEN || e.BLOB_STORE_ID) return 'blob';
  return e.VERCEL ? 'unconfigured' : 'local';
}

/** The store for this process: Supabase, then Vercel Blob, then local disk. */
export function objectStore(): ObjectStore {
  if (store) return store;
  const kind = storeKind({
    SUPABASE_URL: env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
    BLOB_READ_WRITE_TOKEN: env.BLOB_READ_WRITE_TOKEN,
    BLOB_STORE_ID: env.BLOB_STORE_ID,
    VERCEL: process.env.VERCEL,
  });
  store =
    kind === 'supabase'
      ? createSupabaseStore(supabaseStorageFromEnv())
      : kind === 'blob'
        ? createBlobStore()
        : kind === 'unconfigured'
          ? unconfiguredStore(createLocalStore(uploadRoot()))
          : createLocalStore(uploadRoot());
  return store;
}
