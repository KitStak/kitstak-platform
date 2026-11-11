import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLocalStore, localObjectPath } from './storage';

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
