import { describe, expect, it } from 'vitest';
import { PROJECT_KEY_PATTERN } from './constants';
import { parseTaskKey, suggestProjectKey, taskKey } from './task-key';

describe('task keys', () => {
  it('formats and parses', () => {
    expect(taskKey('OPS', 42)).toBe('OPS-42');
    expect(parseTaskKey('ops-42')).toEqual({ projectKey: 'OPS', number: 42 });
    expect(parseTaskKey('OPS42')).toBeNull();
  });

  it('suggests valid unique project keys', () => {
    expect(suggestProjectKey('Warehouse go-live')).toBe('WGL');
    expect(suggestProjectKey('Operations')).toBe('OPER');
    expect(suggestProjectKey('Operations', new Set(['OPER']))).toBe('OPER2');
    for (const name of ['a', '2027 plan', 'Q4 Marketing Campaign Launch', '!!!']) {
      expect(suggestProjectKey(name)).toMatch(PROJECT_KEY_PATTERN);
    }
  });
});
