import { describe, expect, it } from 'vitest';
import { applySubscriberChange, MAX_EXPLICIT_SUBSCRIBERS } from '@/server/services/contracts/item-panel';
import { UPLOAD_BASE_TIMEOUT_MS, UPLOAD_MAX_TIMEOUT_MS, UPLOAD_TIMEOUT_PER_MB_MS, uploadTimeoutFor } from '../hooks/use-upload-queue';
import { neighbors } from './item-order';

describe('uploadTimeoutFor', () => {
  it('gives small files the base timeout', () => {
    expect(uploadTimeoutFor(22)).toBe(UPLOAD_BASE_TIMEOUT_MS);
  });
  it('scales with file size', () => {
    expect(uploadTimeoutFor(10 * 1024 * 1024)).toBe(UPLOAD_BASE_TIMEOUT_MS + 10 * UPLOAD_TIMEOUT_PER_MB_MS);
  });
  it('is capped for huge files', () => {
    expect(uploadTimeoutFor(10 * 1024 * 1024 * 1024)).toBe(UPLOAD_MAX_TIMEOUT_MS);
  });
});

describe('applySubscriberChange', () => {
  it('adds and removes, with the latest choice winning', () => {
    const start = { added: ['a'], removed: ['b'] };
    expect(applySubscriberChange(start, { add: ['b'], remove: ['a'] })).toEqual({ added: ['b'], removed: ['a'] });
  });
  it('does not mutate the input', () => {
    const start = { added: ['a'], removed: [] as string[] };
    applySubscriberChange(start, { add: ['c'], remove: [] });
    expect(start).toEqual({ added: ['a'], removed: [] });
  });
  it('caps each list', () => {
    const many = Array.from({ length: MAX_EXPLICIT_SUBSCRIBERS + 10 }, (_, index) => `u${index}`);
    expect(applySubscriberChange({ added: [], removed: [] }, { add: many, remove: [] }).added).toHaveLength(MAX_EXPLICIT_SUBSCRIBERS);
  });
});

describe('neighbors for items outside the list', () => {
  it('reports index 0 so the header hides prev/next', () => {
    expect(neighbors(['a', 'b'], 'trashed')).toEqual({ prevId: null, nextId: null, index: 0, total: 2 });
  });
});
