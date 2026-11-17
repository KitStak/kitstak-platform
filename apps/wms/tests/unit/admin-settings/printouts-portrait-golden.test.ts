/**
 * Golden ZPL for portrait label stocks. The snapshot was recorded before landscape support
 * was added, so any byte that changes here is a regression for templates already in use.
 */
import { describe, expect, it } from 'vitest';
import {
  blockDefaults,
  blockKeyOf,
  layoutSchema,
  templatesFor,
  type PrintoutLayout,
} from '@/lib/grid-defs/admin/printouts';
import { builtInSample, renderLayoutZpl } from '@/server/repositories/printouts-render';

const NOW = new Date('2026-11-17T12:00:00.000Z');

function everyBlock(paper: PrintoutLayout['paper'], barcodeType: PrintoutLayout['barcodeType']) {
  const base = templatesFor('product-label')[0]!.layout('product-label');
  const blocks = [
    { ...blockDefaults('text', 'bt0001'), text: 'Handle with care', align: 'center' as const },
    { ...blockDefaults('field', 'bf0001'), text: 'Client: ', field: 'clientName', align: 'right' as const },
    { ...blockDefaults('barcode', 'bb0001'), align: 'center' as const },
    { ...blockDefaults('barcode', 'bb0002'), symbology: 'qrcode' as const, align: 'right' as const },
    { ...blockDefaults('barcode', 'bb0003'), symbology: 'datamatrix' as const },
    { ...blockDefaults('barcode', 'bb0004'), symbology: 'code39' as const },
    blockDefaults('image', 'bi0001'),
    blockDefaults('divider', 'bd0001'),
    blockDefaults('spacer', 'bs0001'),
  ];
  return layoutSchema.parse({
    ...base,
    paper,
    barcodeType,
    labelLanguage: 'ZPL',
    blocks,
    sections: [
      ...base.sections.map((s) => ({ ...s, enabled: true })),
      ...blocks.map((b) => ({ key: blockKeyOf(b.id), enabled: true })),
    ],
  });
}

describe('portrait label ZPL is unchanged', () => {
  for (const paper of ['4x6', '4x4', '4x3', '4x2', '3x2', '2x1'] as const) {
    it(`${paper} with every section and block kind`, () => {
      const zpl = renderLayoutZpl(
        everyBlock(paper, paper === '4x4' ? 'qrcode' : 'code128'),
        [builtInSample('product-label')],
        { companyName: 'KitStaks', now: NOW },
        2,
      );
      expect(zpl).toMatchSnapshot();
    });
  }
});
