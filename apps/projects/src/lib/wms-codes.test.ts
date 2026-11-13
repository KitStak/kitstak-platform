import { describe, expect, it } from 'vitest';
import { findWmsCodes, normalizeWmsCodes } from './wms-codes';

describe('findWmsCodes', () => {
  it('pads short codes to the WMS format', () => {
    const [match] = findWmsCodes('Investigate putaway delays on PO2240');
    expect(match).toMatchObject({ code: 'PO002240', type: 'wms_receipt', raw: 'PO2240' });
  });

  it('reads every WMS prefix, any case and common separators', () => {
    expect(findWmsCodes('so10858 then wo-94 and CNT#144').map((m) => [m.code, m.type])).toEqual([
      ['SO010858', 'wms_order'],
      ['WO000094', 'wms_work_order'],
      ['CNT000144', 'wms_count'],
    ]);
  });

  it('keeps codes already in WMS format and ignores words that only look alike', () => {
    expect(findWmsCodes('PO002240').map((m) => m.code)).toEqual(['PO002240']);
    expect(findWmsCodes('Call SOLO2240 about the POS9 photo, PO0, XPO12, PO1234567')).toEqual([]);
  });

  it('lists each code once', () => {
    expect(findWmsCodes('PO2240 and PO002240')).toHaveLength(1);
  });
});

describe('normalizeWmsCodes', () => {
  it('rewrites the typed codes in place', () => {
    const text = 'Recheck po2240 after wo 94';
    expect(normalizeWmsCodes(text, findWmsCodes(text))).toBe('Recheck PO002240 after WO000094');
  });
});
