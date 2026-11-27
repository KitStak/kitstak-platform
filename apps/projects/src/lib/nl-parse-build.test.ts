import { describe, expect, it } from 'vitest';
import { looksLikeBuild, parseBuildQuickAdd, suggestVariants, type BuildQuickAddContainer } from './nl-parse-build';

const GLOVE: BuildQuickAddContainer = {
  id: 'p-glove',
  key: 'GLOVE',
  name: 'Glove kits',
  kind: 'program',
  unit: { singular: 'kit', plural: 'kits' },
  variants: [
    { id: 'v-sb', key: 'S-BR', name: 'Small Brown', sku: 'GLOVE-S-BR' },
    { id: 'v-sy', key: 'S-YE', name: 'Small Yellow', sku: 'GLOVE-S-YE' },
    { id: 'v-mb', key: 'M-BR', name: 'Medium Brown', sku: 'GLOVE-M-BR' },
    { id: 'v-xlb', key: 'XL-BR', name: 'XL Brown', sku: 'GLOVE-XL-BR' },
  ],
};
const ECOMM: BuildQuickAddContainer = {
  id: 'p-ecomm',
  key: 'ECOMM',
  name: 'Ecommerce orders',
  kind: 'program',
  variants: [
    { id: 'v-gift', key: 'GIFT', name: 'Gift box', sku: 'ECOM-GIFT' },
    { id: 'v-std', key: 'STD', name: 'Standard order', sku: 'ECOM-STD' },
  ],
};
const FRA: BuildQuickAddContainer = { id: 'p-fra', key: 'FRA', name: 'Frame retool', kind: 'project', variants: [] };
const containers = [GLOVE, ECOMM, FRA];
// 2026-11-25 is a Wednesday.
const today = '2026-11-25';

describe('parseBuildQuickAdd', () => {
  it('reads the spec example "build 100 small brown glove tomorrow"', () => {
    const parse = parseBuildQuickAdd('build 100 small brown glove tomorrow', { containers, today });
    expect(parse.buildMode).toBe(true);
    expect(parse.containerId).toBe('p-glove');
    expect(parse.variantId).toBe('v-sb');
    expect(parse.qty).toBe('100');
    expect(parse.date).toBe('2026-11-26');
    expect(parse.unresolved).toEqual([]);
    expect(parse.segments.map((s) => s.kind)).toEqual(['mode', null, 'qty', null, 'variant', null, 'program', null, 'date']);
  });

  it('reads "+ECOMM 250 gift fri" without the build word when forced', () => {
    const parse = parseBuildQuickAdd('+ECOMM 250 gift fri', { containers, today, forceBuild: true });
    expect(parse.containerId).toBe('p-ecomm');
    expect(parse.variantId).toBe('v-gift');
    expect(parse.qty).toBe('250');
    expect(parse.date).toBe('2026-11-27');
  });

  it('makes a build in a project for +FRA (no variant)', () => {
    const parse = parseBuildQuickAdd('build 40 +FRA next mon', { containers, today });
    expect(parse.containerId).toBe('p-fra');
    expect(parse.variantId).toBeUndefined();
    expect(parse.qty).toBe('40');
    expect(parse.date).toBe('2026-11-30');
    expect(parse.unresolved).toEqual([]);
  });

  it('matches a SKU exactly and keeps commas out of the qty', () => {
    const parse = parseBuildQuickAdd('build 1,200 GLOVE-XL-BR', { containers, today, defaultContainerId: 'p-glove' });
    expect(parse.qty).toBe('1200');
    expect(parse.variantId).toBe('v-xlb');
  });

  it('uses the default container when no program word is typed', () => {
    const parse = parseBuildQuickAdd('build 60 medium brown', { containers, today, defaultContainerId: 'p-glove' });
    expect(parse.containerId).toBe('p-glove');
    expect(parse.variantId).toBe('v-mb');
  });

  it('flags an unknown variant with suggestions and a missing qty', () => {
    const parse = parseBuildQuickAdd('build small purple glove', { containers, today });
    expect(parse.containerId).toBe('p-glove');
    expect(parse.variantId).toBeUndefined();
    const kinds = parse.unresolved.map((u) => u.kind);
    expect(kinds).toContain('variant');
    expect(kinds).toContain('qty');
    expect(parse.unresolved.find((u) => u.kind === 'variant')?.suggestions[0]).toMatch(/^v-s/);
  });

  it('flags an unknown +KEY', () => {
    const parse = parseBuildQuickAdd('build 10 +NOPE', { containers, today });
    expect(parse.containerId).toBeUndefined();
    expect(parse.unresolved[0]?.kind).toBe('program');
  });

  it('reads assignee and priority', () => {
    const parse = parseBuildQuickAdd('build 100 small yellow glove today @maya !high', { containers, today, people: [{ id: 'u-maya', name: 'Maya Chen' }] });
    expect(parse.assigneeId).toBe('u-maya');
    expect(parse.assigneeToken).toBe('@maya');
    expect(parse.priority).toBe('high');
    expect(parse.variantId).toBe('v-sy');
    expect(parse.date).toBe(today);
  });

  it('is deterministic', () => {
    const a = parseBuildQuickAdd('build 100 small brown glove tomorrow', { containers, today });
    const b = parseBuildQuickAdd('build 100 small brown glove tomorrow', { containers, today });
    expect(a).toEqual(b);
  });
});

describe('helpers', () => {
  it('looksLikeBuild', () => {
    expect(looksLikeBuild('build 100 kits')).toBe(true);
    expect(looksLikeBuild('Build 5')).toBe(true);
    expect(looksLikeBuild('builder meeting')).toBe(false);
  });
  it('suggestVariants ranks closest names first', () => {
    expect(suggestVariants('brown', GLOVE.variants).slice(0, 3)).toEqual(['v-sb', 'v-mb', 'v-xlb']);
  });
});
