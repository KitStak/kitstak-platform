import { describe, expect, it } from 'vitest';
import { buildTitlePreview, closeMonthsFor, settingsSectionsFor } from './settings-model';

describe('settings model', () => {
  it('previews build titles', () => {
    expect(buildTitlePreview('{variant} · {date}', { programKey: 'GLOVE', unit: { singular: 'kit', plural: 'kits' } })).toBe('Small Brown · Nov 25');
    expect(buildTitlePreview('{program} {sku} x{qty}', { programKey: 'GLOVE', unit: { singular: 'kit', plural: 'kits' } })).toBe('GLOVE GLOVE-S-BR x100');
  });
  it('lists months newest first', () => {
    expect(closeMonthsFor('2026-09-15', '2026-11-25')).toEqual(['2026-11', '2026-10', '2026-09']);
    expect(closeMonthsFor(null, '2026-11-25')).toEqual([]);
  });
  it('shows sections by role', () => {
    expect(settingsSectionsFor({ canManage: false, seesSync: false, moneyHidden: true, hasPulseJob: true }).map((section) => section.id)).toEqual(['general', 'units', 'people']);
    expect(settingsSectionsFor({ canManage: true, seesSync: true, moneyHidden: false, hasPulseJob: true }).map((section) => section.id)).toEqual(['general', 'units', 'money', 'close', 'people', 'pulse', 'danger']);
  });
});
