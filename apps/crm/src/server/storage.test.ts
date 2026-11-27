import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLocalStore, createSupabaseStore, localObjectPath, storeKind, type SupabaseStorageApi } from './storage';

describe('local object store', () => {
  let root = '';

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'kitstak-storage-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('round-trips bytes and reports missing keys as null', async () => {
    const store = createLocalStore(root);
    const bytes = new Uint8Array([1, 2, 3]);
    await store.put('org/file', bytes, 'application/octet-stream');
    expect(await store.get('org/file')).toEqual(bytes);
    expect(await store.get('org/missing')).toBeNull();
  });

  it('refuses to overwrite an existing key', async () => {
    const store = createLocalStore(root);
    await store.put('assets/a.png', new Uint8Array([1]), 'image/png');
    await expect(store.put('assets/a.png', new Uint8Array([2]), 'image/png')).rejects.toThrow();
  });

  it('deletes keys and tolerates deleting a missing one', async () => {
    const store = createLocalStore(root);
    await store.put('org/file', new Uint8Array([1]), 'text/plain');
    await store.delete('org/file');
    await store.delete('org/file');
    expect(await store.get('org/file')).toBeNull();
  });

  it('rejects keys that could escape the root', () => {
    for (const key of ['../x', '/etc/passwd', 'a/../../b', 'a//b', '', 'a\\b']) {
      expect(() => localObjectPath(root, key)).toThrow('Invalid storage key');
    }
  });
});

/** An in-memory stand-in for the Supabase storage API (same calls, same error shapes). */
function fakeSupabase(options: { bucketExists?: boolean } = {}) {
  const buckets = new Map<string, Map<string, Uint8Array>>();
  if (options.bucketExists !== false) buckets.set('crm-files', new Map());
  const created: { name: string; isPublic: boolean }[] = [];
  const api = {
    async createBucket(name: string, opts?: { public: boolean }) {
      buckets.set(name, new Map());
      created.push({ name, isPublic: Boolean(opts?.public) });
      return { data: { name }, error: null };
    },
    from(name: string) {
      return {
        async upload(key: string, bytes: Uint8Array) {
          const bucket = buckets.get(name);
          if (!bucket) return { data: null, error: { message: 'Bucket not found' } };
          if (bucket.has(key)) return { data: null, error: { message: 'The resource already exists' } };
          bucket.set(key, bytes);
          return { data: { path: key }, error: null };
        },
        async download(key: string) {
          const found = buckets.get(name)?.get(key);
          return found ? { data: new Blob([new Uint8Array(found)]), error: null } : { data: null, error: { message: 'Object not found' } };
        },
        async remove(keys: string[]) {
          for (const key of keys) buckets.get(name)?.delete(key);
          return { data: [], error: null };
        },
      };
    },
  };
  return { api: api as unknown as SupabaseStorageApi, created };
}

describe('supabase object store', () => {
  it('round-trips bytes and reports missing keys as null', async () => {
    const { api } = fakeSupabase();
    const store = createSupabaseStore(async () => api);
    const bytes = new Uint8Array([4, 5, 6]);
    await store.put('org-1/file', bytes, 'image/png');
    expect(await store.get('org-1/file')).toEqual(bytes);
    expect(await store.get('org-1/missing')).toBeNull();
  });

  it('makes the bucket private on first upload when it does not exist yet', async () => {
    const { api, created } = fakeSupabase({ bucketExists: false });
    const store = createSupabaseStore(async () => api);
    await store.put('org-1/file', new Uint8Array([1]), 'text/plain');
    expect(created).toEqual([{ name: 'crm-files', isPublic: false }]);
  });

  it('refuses to overwrite and rejects unsafe keys', async () => {
    const { api } = fakeSupabase();
    const store = createSupabaseStore(async () => api);
    await store.put('org-1/file', new Uint8Array([1]), 'text/plain');
    await expect(store.put('org-1/file', new Uint8Array([2]), 'text/plain')).rejects.toThrow('could not be stored');
    await expect(store.put('../x', new Uint8Array([1]), 'text/plain')).rejects.toThrow('Invalid storage key');
  });

  it('deletes keys and tolerates deleting a missing one', async () => {
    const { api } = fakeSupabase();
    const store = createSupabaseStore(async () => api);
    await store.put('org-1/file', new Uint8Array([1]), 'text/plain');
    await store.delete('org-1/file');
    await store.delete('org-1/file');
    expect(await store.get('org-1/file')).toBeNull();
  });
});

describe('storeKind', () => {
  it('prefers Supabase, then Blob, then local disk', () => {
    expect(storeKind({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', BLOB_READ_WRITE_TOKEN: 't' })).toBe('supabase');
    expect(storeKind({ BLOB_READ_WRITE_TOKEN: 't' })).toBe('blob');
    expect(storeKind({})).toBe('local');
  });

  it('never picks local disk on Vercel', () => {
    expect(storeKind({ VERCEL: '1' })).toBe('unconfigured');
    expect(storeKind({ VERCEL: '1', SUPABASE_URL: 'https://x.supabase.co' })).toBe('unconfigured');
  });
});
