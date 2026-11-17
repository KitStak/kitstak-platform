/**
 * Landscape label stock (6x4: 6 in wide, 4 in tall). Covers the stock model, the PDF page
 * size and the ZPL II rotation. A Zebra print head is 4 in wide, so a 6x4 design is fed as a
 * 4x6 label (^PW812 / ^LL1218) with every field rotated 90 degrees clockwise.
 */
import { toBuffer } from 'bwip-js/node';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { barcodeAspect } from '@/components/ui/barcode';
import {
  blockDefaults,
  blockKeyOf,
  isLabelStock,
  isLandscapeStock,
  LABEL_STOCKS,
  labelFeed,
  layoutSchema,
  normalizeLayout,
  PAPER_POINTS,
  paperLabel,
  templatesFor,
  type PrintoutLayout,
} from '@/lib/grid-defs/admin/printouts';
import { zplOrigin, zplSymbolSize, zplText, type ZplFrame } from '@/server/print/zpl';
import { builtInSample, renderLayoutPdf, renderLayoutZpl } from '@/server/repositories/printouts-render';

const NOW = new Date('2026-11-17T12:00:00.000Z');
const OPTS = { companyName: 'KitStaks', now: NOW };
const PRINT_WIDTH = 812;
const LABEL_LENGTH = 1218;
const FRAME: ZplFrame = { rotation: 'R', printWidth: PRINT_WIDTH };

const landscape = (over: Partial<PrintoutLayout> = {}): PrintoutLayout =>
  layoutSchema.parse({
    ...templatesFor('product-label')[0]!.layout('product-label'),
    paper: '6x4',
    labelLanguage: 'ZPL',
    ...over,
  });

const withBlocks = (blocks: readonly ReturnType<typeof blockDefaults>[], only = false): PrintoutLayout => {
  const base = landscape();
  return layoutSchema.parse({
    ...base,
    blocks,
    sections: [
      ...base.sections.map((s) => ({ ...s, enabled: only ? false : s.enabled })),
      ...blocks.map((b) => ({ key: blockKeyOf(b.id), enabled: true })),
    ],
  });
};

const render = (layout: PrintoutLayout, copies = 1): string =>
  renderLayoutZpl(layout, [builtInSample('product-label')], OPTS, copies);

/** Every `^FOx,y` in a ZPL string. */
const origins = (zpl: string): [number, number][] =>
  [...zpl.matchAll(/\^FO(-?\d+),(-?\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]);

describe('landscape label stock model', () => {
  it('offers 6x4 as a label stock next to 4x6 and labels it as landscape', () => {
    expect(LABEL_STOCKS).toContain('6x4');
    expect(isLabelStock('6x4')).toBe(true);
    expect(isLandscapeStock('6x4')).toBe(true);
    expect(isLandscapeStock('4x6')).toBe(false);
    expect(paperLabel('6x4')).toBe('6 × 4 in (landscape)');
    expect(paperLabel('4x6')).toBe('4 × 6 in');
  });

  it('sizes 6x4 as 6 in wide by 4 in tall and leaves the portrait sizes alone', () => {
    expect(PAPER_POINTS['6x4']).toEqual([432, 288]);
    expect(PAPER_POINTS['4x6']).toEqual([288, 432]);
    expect(PAPER_POINTS['4x2']).toEqual([288, 144]);
    expect(PAPER_POINTS['2x1']).toEqual([144, 72]);
  });

  it('feeds 6x4 through a 4 in head rotated, and every other stock straight', () => {
    expect(labelFeed('6x4')).toEqual({ widthIn: 4, lengthIn: 6, rotated: true });
    expect(labelFeed('4x6')).toEqual({ widthIn: 4, lengthIn: 6, rotated: false });
    for (const stock of LABEL_STOCKS.filter((s) => s !== '6x4'))
      expect(labelFeed(stock).rotated, stock).toBe(false);
  });

  it('accepts 6x4 for labels only, and it survives a save / reload round trip', () => {
    const doc = templatesFor('packing-slip')[0]!.layout('packing-slip');
    expect(layoutSchema.safeParse({ ...doc, paper: '6x4' }).success).toBe(false);
    const stored: unknown = JSON.parse(JSON.stringify(landscape()));
    const reloaded = normalizeLayout('product-label', stored);
    expect(reloaded.paper).toBe('6x4');
    expect(reloaded).toEqual(landscape());
  });

  it('offers a 6 x 4 landscape base template for label types', () => {
    const template = templatesFor('product-label').find((t) => t.key === 'label-6x4');
    expect(template?.layout('product-label').paper).toBe('6x4');
    expect(layoutSchema.safeParse(template?.layout('product-label')).success).toBe(true);
  });
});

describe('landscape label PDF', () => {
  it('renders a 6 in by 4 in page, and 4x6 stays 4 in by 6 in', async () => {
    const pageSize = async (layout: PrintoutLayout) => {
      const bytes = await renderLayoutPdf('product-label', layout, [builtInSample('product-label')], OPTS);
      const page = (await PDFDocument.load(bytes)).getPage(0);
      return [page.getWidth(), page.getHeight()];
    };
    expect(await pageSize(landscape())).toEqual([432, 288]);
    expect(await pageSize(landscape({ paper: '4x6' }))).toEqual([288, 432]);
  });
});

describe('canvas preview barcode proportions', () => {
  it('matches the PNG the PDF renderer embeds, so both scale the barcode to the same height', async () => {
    for (const [type, value] of [
      ['code128', 'BMS-M8-BLK'],
      ['code39', 'LP000124'],
      ['code128', 'A-VERY-LONG-PRODUCT-CODE-0001'],
    ] as const) {
      const png = await toBuffer({ bcid: type, text: value, scale: 3, height: 18, includetext: false });
      const pdfAspect = png.readUInt32BE(20) / png.readUInt32BE(16);
      expect(barcodeAspect(type, value, 18)).toBeCloseTo(pdfAspect, 2);
    }
  });

  it('returns null for a value the symbology cannot encode', () => {
    expect(barcodeAspect('ean13', 'not-a-number', 18)).toBeNull();
    expect(barcodeAspect('code128', '  ', 18)).toBeNull();
  });
});

describe('zpl rotation helpers', () => {
  it('leaves coordinates alone without a frame', () => {
    expect(zplOrigin(undefined, 24, 71, 40)).toEqual([24, 71]);
  });

  it('maps a design box to the fed label: design x runs down the feed, design y right to left', () => {
    // A 40-dot-tall field at the design's top-left corner sits against the right edge of the feed.
    expect(zplOrigin(FRAME, 0, 0, 40)).toEqual([PRINT_WIDTH - 40, 0]);
    expect(zplOrigin(FRAME, 24, 71, 40)).toEqual([PRINT_WIDTH - 71 - 40, 24]);
    // The design's bottom-left corner is the feed's top-left corner.
    expect(zplOrigin(FRAME, 0, PRINT_WIDTH - 40, 40)).toEqual([0, 0]);
  });

  it('returns null for a field that would run off the bottom of the design', () => {
    expect(zplOrigin(FRAME, 0, PRINT_WIDTH - 39, 40)).toBeNull();
  });

  it('rotates text and reserves every line of a wrapping block', () => {
    expect(zplText({ x: 24, y: 24, text: 'Hi', height: 40, frame: FRAME })).toBe(
      `^FO${PRINT_WIDTH - 24 - 40},24^A0R,40,40^FH\\^FDHi^FS`,
    );
    // Zebra anchors a rotated ^FB block by its full line count; the first line is the rightmost.
    expect(
      zplText({ x: 24, y: 100, text: 'Hi', height: 28, blockWidth: 1170, maxLines: 3, frame: FRAME }),
    ).toBe(`^FO${PRINT_WIDTH - 100 - 3 * 28},24^A0R,28,28^FB1170,3,0,L,0^FH\\^FDHi^FS`);
  });

  it('keeps the lines of a wrapping block that still fit near the bottom of the design', () => {
    const near = { text: 'Hi', height: 28, blockWidth: 1170, maxLines: 3, frame: FRAME };
    // 60 dots left: two 28-dot lines fit, so the block shrinks to two lines instead of vanishing.
    expect(zplText({ ...near, x: 24, y: PRINT_WIDTH - 60 })).toBe(
      `^FO4,24^A0R,28,28^FB1170,2,0,L,0^FH\\^FDHi^FS`,
    );
    expect(zplText({ ...near, x: 24, y: PRINT_WIDTH - 20 })).toBe('');
  });

  it('sizes QR and Data Matrix symbols from their data', () => {
    expect(zplSymbolSize('qrcode', 'BMS-M8-BLK', 5)).toBe(21 * 5);
    expect(zplSymbolSize('qrcode', 'a'.repeat(40), 5)).toBe(33 * 5);
    expect(zplSymbolSize('datamatrix', 'BMS-M8-BLK', 4)).toBe(16 * 4);
    expect(zplSymbolSize('datamatrix', '123456', 4)).toBe(10 * 4);
    expect(zplSymbolSize('pdf417', 'BMS-M8-BLK', 2)).toBeNull();
    expect(zplSymbolSize('code128', 'BMS-M8-BLK', 2)).toBeNull();
  });
});

describe('landscape label ZPL', () => {
  it('declares the fed label (4 in print width, 6 in length), not the design size', () => {
    const zpl = render(landscape());
    expect(zpl).toContain(`^PW${PRINT_WIDTH}`);
    expect(zpl).toContain(`^LL${LABEL_LENGTH}`);
    expect(zpl).not.toContain('^PW1218');
  });

  it('expresses orientation by rotating fields, never with ^PO or ^FW', () => {
    const zpl = render(landscape());
    expect(zpl).not.toMatch(/\^PO|\^FW/);
    expect(zpl).toContain('^A0R,');
    expect(zpl).toContain('^BCR,');
    expect(zpl).not.toMatch(/\^A0N|\^BCN/);
  });

  it('places the built-in sections in design order from the right edge of the feed', () => {
    const lines = render(landscape()).split('\n');
    const title = lines.find((l) => l.includes('Product Label'));
    const barcode = lines.find((l) => l.includes('^BCR'));
    const footer = lines.find((l) => l.includes('^FDPrinted 11/17/2026'));
    // Title: 14 pt -> 39 dots, at the design's top-left margin (24, 24).
    expect(title).toBe(`^FO${PRINT_WIDTH - 24 - 39},24^A0R,39,39^FH\\^FDProduct Label^FS`);
    // Barcode: 30% of the 4 in design height, directly under the title (y = 24 + 39 + 8).
    expect(barcode).toBe(`^FO${PRINT_WIDTH - 71 - 244},24^BY3^BCR,244,N,N,N^FH\\^FDBMS-M8-BLK^FS`);
    // Footer: pinned to the design's bottom margin, which is the left edge of the feed.
    expect(footer).toBe(`^FO26,24^A0R,18,18^FH\\^FDPrinted 11/17/2026 \\C2\\B7 KitStaks^FS`);
  });

  it('keeps every field origin on the fed label', () => {
    const blocks = [
      blockDefaults('text', 'bt0001'),
      blockDefaults('field', 'bf0001'),
      { ...blockDefaults('barcode', 'bb0001'), align: 'right' as const },
      blockDefaults('divider', 'bd0001'),
    ];
    const all = origins(render(withBlocks(blocks)));
    expect(all.length).toBeGreaterThan(6);
    for (const [x, y] of all) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(PRINT_WIDTH);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(LABEL_LENGTH);
    }
  });

  it('aligns blocks across the 6 in design width', () => {
    const bar = { ...blockDefaults('barcode', 'bb0001'), align: 'right' as const, widthPct: 50 };
    const zpl = render(withBlocks([bar], true));
    // inner = 1218 - 48 = 1170; a right-aligned 50% block starts at 24 + 585 down the feed.
    const height = Math.round((bar.height / 72) * 203);
    expect(zpl).toContain(`^FO${PRINT_WIDTH - 24 - height},609^BY2^BCR,${height},N,N,N`);
  });

  it('swaps divider width and height', () => {
    const zpl = render(withBlocks([blockDefaults('divider', 'bd0001')], true));
    expect(zpl).toContain(`^FO${PRINT_WIDTH - 24 - 6},24^GB6,1170,6^FS`);
  });

  it('rotates every 1D and stacked symbology and keeps QR upright (^BQ has no rotation)', () => {
    const zplFor = (symbology: PrintoutLayout['barcodeType']) =>
      render(landscape({ barcodeType: symbology }));
    expect(zplFor('code39')).toContain('^B3R,');
    expect(zplFor('ean13')).toContain('^BER,');
    expect(zplFor('upca')).toContain('^BUR,');
    expect(zplFor('pdf417')).toContain('^B7R,');
    expect(zplFor('datamatrix')).toContain('^BXR,');
    expect(zplFor('gs1-128')).toContain('^BCR,');
    // QR: 21 modules x magnification 5 = 105 dots, top edge at the design y of 71.
    expect(zplFor('qrcode')).toContain(`^FO${PRINT_WIDTH - 71 - 105},24^BQN,2,5`);
  });

  it('anchors 2D symbols by their own size, or by the reserved box when it is unknown', () => {
    const origin = (symbology: PrintoutLayout['barcodeType'], command: string) =>
      render(landscape({ barcodeType: symbology }))
        .split('\n')
        .find((l) => l.includes(command));
    // Data Matrix: 16 modules x 6 dots = 96, top edge at the design y of 71.
    expect(origin('datamatrix', '^BXR')).toContain(`^FO${PRINT_WIDTH - 71 - 96},24^BXR,6,200`);
    // PDF417: size unknown, so it sits at the bottom of the 2 x 244 dot reserved box.
    expect(origin('pdf417', '^B7R')).toContain(`^FO${PRINT_WIDTH - 71 - 488},24^BY3^B7R,`);
    // The code text follows the symbol's real height (71 + 96 + 10), not the reserved box.
    expect(origin('datamatrix', '^FB1170,1,0,C')).toContain(`^FO${PRINT_WIDTH - 177 - 56},24^A0R,56,56`);
  });

  it('drops a field that would fall off the label instead of emitting a negative origin', () => {
    const spacer = { ...blockDefaults('spacer', 'bs0001'), height: 280 };
    const text = { ...blockDefaults('text', 'bt0001'), text: 'Below the edge' };
    const zpl = render(withBlocks([spacer, text], true));
    expect(zpl).not.toContain('^FDBelow the edge');
    expect(zpl).toContain('^FX block bt0001 not sent: it falls outside the label');
    expect(zpl).not.toMatch(/\^FO-/);
  });

  it('still escapes field data and honors copies', () => {
    const zpl = renderLayoutZpl(
      landscape(),
      [{ ...builtInSample('product-label'), code: 'SKU^1~2' }],
      OPTS,
      3,
    );
    expect(zpl).not.toContain('SKU^1~2');
    expect(zpl).toContain('SKU\\5E1\\7E2');
    expect(zpl).toContain('^PQ3');
  });
});
