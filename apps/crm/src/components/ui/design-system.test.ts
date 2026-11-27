import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Badge, Chip, CountBadge, StatusPill } from './badge';
import { LABEL_COLORS, colorForString, isLabelColor, labelColorStyle, toLabelColor } from './label-color';
import { initialsFor } from './avatar';
import { cn } from './cn';

/**
 * Design tokens are shared with KitStak WMS through the @kitstak/ui workspace package
 * (the single source of truth — no per-app copy, so no hash pinning is needed).
 */
const tokensPath = createRequire(import.meta.url).resolve('@kitstak/ui/styles/tokens.css');
const tokens = readFileSync(tokensPath, 'utf8');
const lightBlock = tokens.slice(0, tokens.indexOf("[data-theme='dark']"));

describe('shared design tokens', () => {
  it('imports the @kitstak/ui tokens in globals.css (no local copy)', () => {
    const globals = readFileSync(join(process.cwd(), 'src/styles/globals.css'), 'utf8');
    expect(globals).toContain("@import '@kitstak/ui/styles/tokens.css';");
    expect(existsSync(join(process.cwd(), 'src/styles/tokens.css'))).toBe(false);
  });

  it('defines the core custom properties the design system reads', () => {
    for (const name of [
      'surface-app',
      'surface-panel',
      'surface-raised',
      'border-default',
      'text-primary',
      'text-secondary',
      'text-muted',
      'primary',
      'primary-600',
      'danger',
      'pill-text-mix',
    ]) {
      expect(lightBlock, `--${name}`).toMatch(new RegExp(`--${name}:`));
    }
  });
});

function tokenValue(name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(lightBlock);
  if (!match?.[1]) throw new Error(`token --${name} missing`);
  return match[1];
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r = 0, g = 0, b = 0] = channels.map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
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
      const value =
        new RegExp(`--label-${color}-text:\\s*(#[0-9a-fA-F]{6});`).exec(darkBlock)?.[1] ?? '#000000';
      expect(contrast(value, panel), `dark ${color}-text`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('ships a dark theme for both the attribute and the OS preference', () => {
    expect(tokens).toContain(":root[data-theme='dark']");
    expect(tokens).toContain('@media (prefers-color-scheme: dark)');
    expect(tokens).toContain(":root:not([data-theme='light'])");
  });
});

describe('status pill contrast', () => {
  const darkBlock = tokens.slice(
    tokens.indexOf("[data-theme='dark']"),
    tokens.indexOf('@media (prefers-color-scheme: dark)'),
  );

  function resolve(block: string, name: string, depth = 0): string {
    const raw =
      new RegExp(`--${name}:\\s*([^;]+);`).exec(block)?.[1]?.trim() ??
      new RegExp(`--${name}:\\s*([^;]+);`).exec(lightBlock)?.[1]?.trim();
    if (!raw) throw new Error(`token --${name} missing`);
    const alias = /^var\(--([a-z0-9-]+)\)$/.exec(raw)?.[1];
    return alias && depth < 5 ? resolve(block, alias, depth + 1) : raw;
  }

  function mix(a: string, b: string, share: number): string {
    const channel = (hex: string, i: number) => parseInt(hex.slice(i, i + 2), 16);
    const out = [1, 3, 5].map((i) => Math.round(channel(a, i) * (1 - share) + channel(b, i) * share));
    return `#${out.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
  }

  it.each([
    ['light', lightBlock],
    ['dark', darkBlock],
  ])('keeps pill text at AA on its own tint for every label colour (%s)', (_theme, block) => {
    const share = parseFloat(resolve(block, 'pill-text-mix')) / 100;
    const ink = resolve(block, 'text-primary');
    for (const color of LABEL_COLORS) {
      const text = mix(resolve(block, `label-${color}-text`), ink, share);
      const ratio = contrast(text, resolve(block, `label-${color}-subtle`));
      expect(ratio, `${color} pill ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
    }
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
    expect(labelColorStyle('teal')).toMatchObject({
      '--lc-bg': 'var(--label-teal)',
      '--lc-fg': 'var(--label-teal-fg)',
    });
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

/**
 * The pill recipe (docs/design/UI-CLEANUP.md, "Pills"): Badge draws the shared Pill or Tag, counts
 * are the shared Count, and nothing a person sees as a state is crimson.
 */
describe('badge recipe', () => {
  const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);

  it.each([
    ['neutral', 'neutral'],
    ['success', 'positive'],
    ['warning', 'caution'],
    ['danger', 'critical'],
    ['info', 'info'],
  ] as const)('draws tone %s as the shared %s Pill', (tone, pillTone) => {
    const markup = html(createElement(Badge, { tone, children: 'Active' }));
    expect(markup).toContain('class="ks-dash-pill"');
    expect(markup).toContain(`data-tone="${pillTone}"`);
  });

  it('draws outline as the shared Tag, an identity with no marker', () => {
    const markup = html(createElement(Badge, { tone: 'outline', icon: createElement('svg'), children: 'You' }));
    expect(markup).toContain('class="ks-dash-tag"');
    expect(markup).not.toContain('<svg');
  });

  it('carries at most one marker and no crimson, border or ring', () => {
    const markup = html(createElement(Badge, { tone: 'info', icon: createElement('svg'), children: 'Recommended' }));
    expect(markup.match(/ks-dash-pill-icon/g)).toHaveLength(1);
    expect(markup).not.toContain('ks-dash-pill-dot');
    expect(markup).not.toMatch(/primary|border|ring-/);
  });

  it('draws counts with the shared Count: neutral by default, critical on request, nothing for 0', () => {
    expect(html(createElement(CountBadge, { count: 3 }))).toContain('data-tone="neutral"');
    expect(html(createElement(CountBadge, { count: 3, tone: 'critical' }))).toContain('data-tone="critical"');
    expect(html(createElement(CountBadge, { count: 240 }))).toContain('99+');
    expect(html(createElement(CountBadge, { count: 0 }))).toBe('');
    expect(html(createElement(CountBadge, { count: 7, ringClassName: 'ring-[var(--surface-panel)]' }))).not.toContain('primary');
  });

  it('keeps label pills at 20 px with one dot and no border', () => {
    const markup = html(createElement(StatusPill, { label: 'Working on it', color: 'orange' }));
    expect(markup).toContain('h-5');
    expect(markup).not.toMatch(/h-\[22px\]|border/);
    expect(markup.match(/rounded-full bg-\[var\(--lc-bg\)\]/g)).toHaveLength(1);
  });

  it('marks a selected chip without a crimson ring', () => {
    const markup = html(createElement(Chip, { selected: true, onClick: () => undefined, children: 'Enterprise' }));
    expect(markup).toContain('ring-border-strong');
    expect(markup).not.toContain('ring-primary');
  });
});
