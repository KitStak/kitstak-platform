import { describe, expect, it } from 'vitest';
import { patchQuery } from './use-url-state';

describe('patchQuery', () => {
  it('sets, replaces and removes keys and leaves the rest alone', () => {
    expect(patchQuery('', { tab: 'done' })).toBe('tab=done');
    expect(patchQuery('?tab=done&q=apex', { tab: 'mine' })).toBe('tab=mine&q=apex');
    expect(patchQuery('tab=done&q=apex', { q: null })).toBe('tab=done');
    expect(patchQuery('tab=done&q=apex', { q: '', tab: undefined })).toBe('');
  });

  it('encodes what a person typed', () => {
    expect(new URLSearchParams(patchQuery('', { job: 'J-1042 & co' })).get('job')).toBe('J-1042 & co');
  });
});
