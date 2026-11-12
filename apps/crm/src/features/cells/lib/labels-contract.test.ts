import { describe, expect, it } from 'vitest';
import { saveLabelsInputSchema } from '@/server/services/cells-support';

const blank = { id: 'z', name: '', color: 'gray', position: 9, isDefault: true } as const;

describe('labels PUT contract', () => {
  it('accepts a normal list with an unnamed blank label', () => {
    expect(saveLabelsInputSchema.safeParse({ labels: [{ id: 'a', name: 'A', color: 'green', position: 0 }, blank], reassign: {} }).success).toBe(true);
  });
  it('rejects case-insensitive duplicate names, empty names, empty lists and two Done labels', () => {
    const parse = (labels: unknown[]) => saveLabelsInputSchema.safeParse({ labels, reassign: {} }).success;
    expect(parse([{ id: 'a', name: 'B', color: 'green', position: 0 }, { id: 'b', name: ' b ', color: 'red', position: 1 }])).toBe(false);
    expect(parse([{ id: 'a', name: '  ', color: 'green', position: 0 }])).toBe(false);
    expect(parse([])).toBe(false);
    expect(parse([{ id: 'a', name: 'A', color: 'green', position: 0, isDone: true }, { id: 'b', name: 'B', color: 'red', position: 1, isDone: true }])).toBe(false);
  });
});
