import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LABEL_COLORS } from '@/server/db/schema/column-types';
import type { ColumnDto, UserSummaryDto } from '@/server/services/contracts/dto';
import { cellToText, rememberCopiedCell, textToCell } from './clipboard';
import { contrastRatio, parseHex } from './contrast';
import { LABEL_PALETTE_ORDER } from './labels';
import { clearUndo, discardUndo, popUndo, pushUndo, undoDepth } from './undo-stack';

const NOW = new Date(2026, 10, 5, 12, 0, 0);
const USERS = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Maya Chen', email: 'maya@example.com', image: null },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Dev Patel', email: 'dev@example.com', image: null },
] as unknown as UserSummaryDto[];
const ctx = { users: USERS, now: NOW };

function column(type: ColumnDto['type'], settings: Record<string, unknown> = {}): Pick<ColumnDto, 'type' | 'settings'> {
  return { type, settings } as Pick<ColumnDto, 'type' | 'settings'>;
}

const STATUS = column('status', {
  labels: [
    { id: 'w', name: 'Working on it', color: 'orange', position: 0 },
    { id: 's', name: 'Stuck', color: 'red', position: 1 },
    { id: 'z', name: '', color: 'gray', position: 2, isDefault: true },
  ],
});

describe('cell clipboard', () => {
  it('copies status by label name and pastes it back by name (case-insensitive)', () => {
    expect(cellToText(STATUS, { labelId: 's' }, ctx)).toBe('Stuck');
    expect(textToCell(STATUS, 'stuck', ctx)).toEqual({ labelId: 's' });
    expect(textToCell(STATUS, 'Nope', ctx)).toBeUndefined();
  });

  it('pastes people by name or email, numbers leniently, checkboxes from words', () => {
    expect(textToCell(column('people'), 'Maya Chen, dev@example.com', ctx)).toEqual({ ids: [USERS[0]?.id, USERS[1]?.id] });
    expect(textToCell(column('number'), '$1,200', ctx)).toBe(1200);
    expect(textToCell(column('checkbox'), 'yes', ctx)).toBe(true);
    expect(textToCell(column('email'), 'not an email', ctx)).toBeUndefined();
    expect(textToCell(column('date'), '2026-11-20', ctx)).toEqual({ date: '2026-11-20' });
    expect(textToCell(column('tags'), '#a, b, a', ctx)).toEqual({ tags: ['a', 'b'] });
  });

  it('round-trips values text cannot carry when pasting the last copied cell', () => {
    const value = { fileIds: ['33333333-3333-4333-8333-333333333333'] };
    rememberCopiedCell({ type: 'files', text: 'deck.pdf', value });
    expect(textToCell(column('files'), 'deck.pdf', ctx)).toEqual(value);
  });

  it('empty paste clears (never the name)', () => {
    expect(textToCell(column('text'), '   ', ctx)).toBeNull();
    expect(textToCell(column('name'), '', ctx)).toBeUndefined();
  });
});

describe('undo stack', () => {
  it('pops the most recent entry and supports discarding', () => {
    clearUndo();
    const a = { label: 'A', undo: () => undefined };
    const b = { label: 'B', undo: () => undefined };
    pushUndo(a);
    pushUndo(b);
    expect(undoDepth()).toBe(2);
    discardUndo(b);
    expect(popUndo()).toBe(a);
    expect(popUndo()).toBeNull();
  });
});

describe('label palette order', () => {
  it('contains every label color exactly once, 8 hue columns x 3 rows', () => {
    expect([...LABEL_PALETTE_ORDER].sort()).toEqual([...LABEL_COLORS].sort());
    expect(LABEL_PALETTE_ORDER).toHaveLength(24);
    // Column n: vivid on row 1, its light tint on row 3.
    for (let index = 0; index < 8; index += 1) {
      expect(LABEL_PALETTE_ORDER[16 + index]).toBe(`${LABEL_PALETTE_ORDER[index]}-light`);
    }
  });
});

describe('dark theme tokens (round 3)', () => {
  const tokens = readFileSync(path.resolve(__dirname, '../../../styles/tokens.css'), 'utf8');
  const darkStart = tokens.indexOf(":root[data-theme='dark']");
  const darkBlock = tokens.slice(darkStart, tokens.indexOf('@media (prefers-color-scheme: dark)', darkStart));
  const mediaBlock = tokens.slice(tokens.indexOf('@media (prefers-color-scheme: dark)', darkStart));
  const lightBlock = tokens.slice(0, darkStart);
  const read = (block: string, name: string) => new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block)?.[1] as string;

  it('team tile icon (label text on label subtle) reaches 3:1 in light and both dark selectors', () => {
    for (const block of [lightBlock, darkBlock, mediaBlock]) {
      expect(contrastRatio(read(block, 'label-indigo-text') ?? read(lightBlock, 'label-indigo-text'), read(block, 'label-indigo-subtle'))).toBeGreaterThanOrEqual(3);
    }
  });

  it('dark pastel pills keep their saturation (not greyed out)', () => {
    const saturation = (hex: string) => {
      const [r, g, b] = (parseHex(hex) ?? [0, 0, 0]).map((value) => value / 255) as [number, number, number];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const light = (max + min) / 2;
      return max === min ? 0 : (max - min) / (1 - Math.abs(2 * light - 1));
    };
    for (const color of LABEL_COLORS.filter((entry) => entry.endsWith('-light'))) {
      for (const block of [darkBlock, mediaBlock]) {
        expect(saturation(read(block, `label-${color}`)), color).toBeGreaterThanOrEqual(0.33);
      }
    }
  });
});
