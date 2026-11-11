import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LABEL_COLORS, colorForString, isLabelColor, labelColorStyle, toLabelColor } from './label-color';
import { initialsFor } from './avatar';
import { cn } from './cn';

const tokens = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8');
const lightBlock = tokens.slice(0, tokens.indexOf("[data-theme='dark']"));

/**
 * src/styles/tokens.css is shared byte-for-byte with KitStak WMS (same path there).
 * This hash is pinned in BOTH repos. To change a token: edit the file, update the hash,
 * then copy the file and the hash to the other repo. A one-sided edit fails here.
 */
const SHARED_TOKENS_SHA256 = '50f9586235084b90b0db2d4ab75071140a565405ea7425e3be3f76195d50d4cf';

describe('shared design tokens', () => {
  it('matches the hash pinned in both KitStak repos (no drift)', () => {
    const actual = createHash('sha256').update(tokens.replace(/\r\n/g, '\n')).digest('hex');
    expect(
      actual,
      'src/styles/tokens.css changed. Update SHARED_TOKENS_SHA256 here AND copy the file and hash to the other KitStak repo.',
    ).toBe(SHARED_TOKENS_SHA256);
  });
});

function tokenValue(name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(lightBlock);
  if (!match?.[1]) throw new Error(`token --${name} missing`);
  return match[1];
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r = 0, g = 0, b = 0] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('label palette tokens', () => {
  it('defines base, hover, subtle and fg for every schema label color', () => {
    for (const color of LABEL_COLORS) {
      for (const suffix of ['', '-hover', '-subtle', '-fg']) {
        expect(lightBlock, `--label-${color}${suffix}`).toMatch(new RegExp(`--label-${color}${suffix}:`));
      }
    }
    expect(LABEL_COLORS.length).toBeGreaterThanOrEqual(20);
  });

  it('meets WCAG AA (4.5:1) for pill text on every label color', () => {
    for (const color of LABEL_COLORS) {
      const ratio = contrast(tokenValue(`label-${color}`), tokenValue(`label-${color}-fg`));
      expect(ratio, `${color} contrast ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps the base palette vivid and gives every color AA text on light panels', () => {
    const bases = LABEL_COLORS.filter((color) => !color.endsWith('-light'));
    for (const color of bases) {
      const text = tokenValue(`label-${color}-text`);
      expect(contrast(text, '#ffffff'), `${color}-text`).toBeGreaterThanOrEqual(4.5);
    }
    // Vivid hues keep their luminance; bright ones carry ink text instead of being darkened.
    expect(tokenValue('label-green-fg')).toBe('#1f2533');
    expect(tokenValue('label-orange-fg')).toBe('#1f2533');
  });

  it('meets AA for body and muted text on panels', () => {
    expect(contrast(tokenValue('text-primary'), '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tokenValue('text-secondary'), '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tokenValue('text-muted'), '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tokenValue('primary-600'), '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps white text on dark-theme primary and danger fills at AA', () => {
    const darkBlock = tokens.slice(tokens.indexOf("[data-theme='dark']"));
    for (const name of ['primary', 'danger']) {
      const value = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6});`).exec(darkBlock)?.[1] ?? '#000000';
      expect(contrast(value, '#ffffff'), `dark ${name}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps dark label text readable on dark panels', () => {
    const darkBlock = tokens.slice(tokens.indexOf("[data-theme='dark']"));
    const panel = /--surface-panel:\s*(#[0-9a-fA-F]{6});/.exec(darkBlock)?.[1] ?? '#000000';
    for (const color of LABEL_COLORS.filter((name) => !name.endsWith('-light'))) {
      const value = new RegExp(`--label-${color}-text:\\s*(#[0-9a-fA-F]{6});`).exec(darkBlock)?.[1] ?? '#000000';
      expect(contrast(value, panel), `dark ${color}-text`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('ships a dark theme for both the attribute and the OS preference', () => {
    expect(tokens).toContain(":root[data-theme='dark']");
    expect(tokens).toContain('@media (prefers-color-scheme: dark)');
    expect(tokens).toContain(":root:not([data-theme='light'])");
  });
});

describe('label-color helpers', () => {
  it('validates and coerces palette names', () => {
    expect(isLabelColor('green')).toBe(true);
    expect(isLabelColor('chartreuse')).toBe(false);
    expect(toLabelColor(42)).toBe('gray');
    expect(toLabelColor('nope', 'blue')).toBe('blue');
  });

  it('exposes css variables for a color', () => {
    expect(labelColorStyle('teal')).toMatchObject({ '--lc-bg': 'var(--label-teal)', '--lc-fg': 'var(--label-teal-fg)' });
  });

  it('assigns deterministic colors', () => {
    expect(colorForString('Ana Duarte')).toBe(colorForString('Ana Duarte'));
    expect(isLabelColor(colorForString(''))).toBe(true);
  });
});

describe('initialsFor', () => {
  it.each([
    ['Ana Duarte', 'AD'],
    ['cher', 'CH'],
    ['jordan.rivera@acme.com', 'JR'],
    ['  ', '?'],
    ['Mary Jane Watson', 'MW'],
  ])('%s → %s', (name, expected) => {
    expect(initialsFor(name)).toBe(expected);
  });
});

describe('cn', () => {
  it('keeps text color and custom font size together', () => {
    expect(cn('text-sm', 'text-fg')).toBe('text-sm text-fg');
    expect(cn('text-sm', 'text-base')).toBe('text-base');
    expect(cn('px-2', false, 'px-3')).toBe('px-3');
  });
});
