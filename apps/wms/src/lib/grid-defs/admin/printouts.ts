/**
 * Printouts & Labels (M14): categories, the per-type template list, the 5-step wizard schema
 * and the structured layout model the designer edits and the preview renderer honors. PURE.
 */
import { z } from 'zod';
import { PRINT_MODES, PRINT_RECORDS_PER_PAGE, PRINTER_TYPES } from '@/lib/enums';
import { PRINT_TYPES, type PrintCategory, type PrintTypeDef } from '@/server/print/catalog';
import { idField, requiredText, versionField, type AdminField } from './common';

export const PRINTOUTS_GRID_KEY = 'printouts';

export const CATEGORY_LABELS: Readonly<Record<PrintCategory | 'all', string>> = {
  all: 'All',
  lists: 'Lists',
  labels: 'Labels',
  billings: 'Billings',
  others: 'Others',
};
export const CATEGORY_SLUGS = ['all', 'lists', 'labels', 'billings', 'others'] as const;
export type CategorySlug = (typeof CATEGORY_SLUGS)[number];

/** Correct counts (Logiwa shows 25/11 but lists 23/9 cards). */
export function categoryCounts(types: readonly PrintTypeDef[] = PRINT_TYPES): Record<CategorySlug, number> {
  return {
    all: types.length,
    lists: types.filter((t) => t.category === 'lists').length,
    labels: types.filter((t) => t.category === 'labels').length,
    billings: types.filter((t) => t.category === 'billings').length,
    others: types.filter((t) => t.category === 'others').length,
  };
}

/* ---------------- layout model ---------------- */

/** Document stock first, then thermal label stock (inches, width x height). */
export const DOCUMENT_PAPERS = ['Letter', 'A4', 'Legal'] as const;
export const LABEL_STOCKS = ['4x6', '4x4', '4x3', '4x2', '3x2', '2x1'] as const;
export const PAPER_SIZES = [...DOCUMENT_PAPERS, ...LABEL_STOCKS] as const;
export type PaperSize = (typeof PAPER_SIZES)[number];
export const isLabelStock = (paper: string): boolean => (LABEL_STOCKS as readonly string[]).includes(paper);
export function paperLabel(paper: string): string {
  if (isLabelStock(paper)) return `${paper.replace('x', ' × ')} in`;
  return paper === 'Legal'
    ? 'Legal (8.5 × 14 in)'
    : paper === 'Letter'
      ? 'Letter (8.5 × 11 in)'
      : 'A4 (210 × 297 mm)';
}

/** Barcode symbologies the renderer can draw (bwip-js ids). */
export const BARCODE_SYMBOLOGIES = [
  'code128',
  'code39',
  'gs1-128',
  'ean13',
  'upca',
  'qrcode',
  'datamatrix',
  'pdf417',
] as const;
export type BarcodeSymbology = (typeof BARCODE_SYMBOLOGIES)[number];
export const SYMBOLOGY_LABELS: Readonly<Record<BarcodeSymbology, string>> = {
  code128: 'Code 128',
  code39: 'Code 39',
  'gs1-128': 'GS1-128',
  ean13: 'EAN-13',
  upca: 'UPC-A',
  qrcode: 'QR code',
  datamatrix: 'Data Matrix',
  pdf417: 'PDF417',
};
/** 2D codes keep their own aspect ratio (the bar height does not apply). */
export const isTwoDimensional = (sym: BarcodeSymbology): boolean =>
  sym === 'qrcode' || sym === 'datamatrix' || sym === 'pdf417';

/** Label printer output language. PDF prints through the browser; ZPL goes raw to Zebra printers. */
export const LABEL_LANGUAGES = ['PDF', 'ZPL'] as const;
export const FONTS = ['Helvetica', 'Times', 'Courier'] as const;
export const LOGO_POSITIONS = ['left', 'center', 'right', 'hidden'] as const;

export type LayoutFamily = 'document' | 'label';

export interface SectionDef {
  readonly key: string;
  readonly label: string;
  readonly description: string;
}
export interface ColumnDef {
  readonly key: string;
  readonly label: string;
  readonly width: number;
  readonly align?: 'left' | 'right';
}

export const DOCUMENT_SECTIONS: readonly SectionDef[] = [
  { key: 'logo', label: 'Logo', description: 'Company logo from Company Settings' },
  { key: 'header', label: 'Title and summary', description: 'Document title, record code and key dates' },
  { key: 'barcode', label: 'Barcode', description: 'Code 128 barcode of the record code' },
  { key: 'addresses', label: 'Addresses', description: 'Ship to and ship from' },
  { key: 'lines', label: 'Lines table', description: 'One row per line with the columns below' },
  { key: 'totals', label: 'Totals', description: 'Units and amount totals' },
  { key: 'notes', label: 'Notes', description: 'Gift message and order notes' },
  { key: 'footer', label: 'Footer', description: 'Footer text and page numbers' },
];

export const LABEL_SECTIONS: readonly SectionDef[] = [
  { key: 'logo', label: 'Logo', description: 'Company logo' },
  { key: 'title', label: 'Title', description: 'Label heading' },
  { key: 'barcode', label: 'Barcode', description: 'Code 128 barcode' },
  { key: 'code', label: 'Code text', description: 'Human-readable code under the barcode' },
  { key: 'details', label: 'Details', description: 'Secondary lines (name, client, location)' },
  { key: 'footer', label: 'Footer', description: 'Printed date' },
];

export const DOCUMENT_COLUMNS: readonly ColumnDef[] = [
  { key: 'location', label: 'Location', width: 0.14 },
  { key: 'sku', label: 'SKU', width: 0.18 },
  { key: 'description', label: 'Description', width: 0.32 },
  { key: 'lot', label: 'Lot', width: 0.1 },
  { key: 'uom', label: 'UOM', width: 0.08 },
  { key: 'qty', label: 'Qty', width: 0.08, align: 'right' },
  { key: 'price', label: 'Price', width: 0.1, align: 'right' },
  { key: 'total', label: 'Total', width: 0.1, align: 'right' },
];

/* ---------------- custom blocks (designer palette) ---------------- */

export const BLOCK_KINDS = ['text', 'field', 'barcode', 'image', 'divider', 'spacer'] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];
export const BLOCK_KIND_LABELS: Readonly<Record<BlockKind, string>> = {
  text: 'Static text',
  field: 'Data field',
  barcode: 'Barcode',
  image: 'Image',
  divider: 'Divider line',
  spacer: 'Spacer',
};
export const BLOCK_PREFIX = 'block:';
export const MAX_BLOCKS = 20;
/** Inline images are stored in the layout as data URLs; keep them small (about 150 KB). */
export const MAX_IMAGE_DATA_URL = 200_000;

export interface BindableField {
  readonly key: string;
  readonly label: string;
  readonly sample: string;
}

/** Record fields a Data field / Barcode block can bind to (custom fields add "custom:<slot>"). */
export const BINDABLE_FIELDS: readonly BindableField[] = [
  { key: 'code', label: 'Record code', sample: 'SO010412' },
  { key: 'reference', label: 'Reference / store order #', sample: '#40117' },
  { key: 'date', label: 'Record date', sample: '11/5/2026' },
  { key: 'clientName', label: 'Client', sample: 'Apex Threads Co.' },
  { key: 'carrier', label: 'Carrier / service', sample: 'UPS / Ground' },
  { key: 'customerName', label: 'Ship-to name', sample: 'Jordan Reyes' },
  {
    key: 'shipToAddress',
    label: 'Ship-to address (one line)',
    sample: '418 Lakeview Ave, Columbus, OH 43215',
  },
  { key: 'shipFrom', label: 'Ship-from (warehouse)', sample: 'MLT1 - Main Fulfillment' },
  { key: 'totalUnits', label: 'Total units', sample: '4' },
  { key: 'lineCount', label: 'Line count', sample: '3' },
  { key: 'notes', label: 'Notes', sample: 'Gift order' },
  { key: 'companyName', label: 'Company name', sample: 'KitStaks' },
  { key: 'printedAt', label: 'Printed date', sample: '11/10/2026' },
];
export const CUSTOM_FIELD_PREFIX = 'custom:';

/** A printable record (order, label subject) as the renderers and the canvas preview see it. */
export interface PrintRecordLine {
  readonly location?: string;
  readonly sku: string;
  readonly description: string;
  readonly lot?: string;
  readonly uom?: string;
  readonly qty: number;
  readonly price?: number;
}

export interface PrintRecord {
  readonly code: string;
  readonly reference?: string;
  readonly date?: string;
  readonly clientName?: string;
  readonly carrier?: string;
  readonly shipTo?: readonly string[];
  readonly shipFrom?: readonly string[];
  readonly lines: readonly PrintRecordLine[];
  readonly notes?: string;
  /** Label details (location / LP / product labels). */
  readonly details?: readonly string[];
  /** Custom field values keyed `custom:<slot>`. */
  readonly fields?: Readonly<Record<string, string>>;
}

/** M/D/YYYY in UTC (matches the PDF renderer). */
export function printDate(value: string | undefined, now: Date = new Date()): string {
  const d = value ? new Date(value) : now;
  return Number.isNaN(d.getTime())
    ? String(value)
    : `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
}

/** Value of a bindable field on a record ("" when the record has none). PURE. */
export function printFieldValue(
  record: PrintRecord,
  key: string,
  opts: { readonly companyName: string; readonly now?: Date },
): string {
  if (key.startsWith(CUSTOM_FIELD_PREFIX)) return record.fields?.[key] ?? '';
  const now = opts.now ?? new Date();
  switch (key) {
    case 'code':
      return record.code;
    case 'reference':
      return record.reference ?? '';
    case 'date':
      return record.date ? printDate(record.date, now) : '';
    case 'clientName':
      return record.clientName ?? '';
    case 'carrier':
      return record.carrier ?? '';
    case 'customerName':
      return record.shipTo?.[0] ?? '';
    case 'shipToAddress':
      return (record.shipTo ?? []).slice(1).filter(Boolean).join(', ');
    case 'shipFrom':
      return record.shipFrom?.[0] ?? record.details?.[0] ?? '';
    case 'totalUnits':
      return String(record.lines.reduce((n, l) => n + l.qty, 0));
    case 'lineCount':
      return String(record.lines.length);
    case 'notes':
      return record.notes ?? '';
    case 'companyName':
      return opts.companyName;
    case 'printedAt':
      return printDate(undefined, now);
    default:
      return '';
  }
}

const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex color like #1F2A44');

export const blockSchema = z.object({
  id: z.string().regex(/^[a-z0-9]{4,12}$/, 'Invalid block id'),
  kind: z.enum(BLOCK_KINDS),
  /** Static text; for field blocks an optional caption printed before the value ("Ship by: "). */
  text: z.string().max(300, 'At most 300 characters').default(''),
  field: z.string().max(60).default('code'),
  align: z.enum(['left', 'center', 'right']).default('left'),
  size: z.number().int().min(6, 'At least 6 pt').max(48, 'At most 48 pt').default(10),
  bold: z.boolean().default(false),
  color: hexColorSchema.default('#111827'),
  symbology: z.enum(BARCODE_SYMBOLOGIES).default('code128'),
  /** Barcode bar height / image height / spacer height, in points. */
  height: z.number().int().min(2, 'At least 2 pt').max(400, 'At most 400 pt').default(40),
  /** Width as a share of the printable width (barcode / image). */
  widthPct: z.number().int().min(10, 'At least 10%').max(100, 'At most 100%').default(60),
  imageDataUrl: z
    .string()
    .max(MAX_IMAGE_DATA_URL, 'Image is too large (max about 150 KB)')
    .regex(/^(data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+)?$/, 'Use a PNG or JPEG image')
    .default(''),
});
export type PrintBlock = z.output<typeof blockSchema>;

export function newBlockId(seed: number = Math.floor(Math.random() * 36 ** 6)): string {
  return `b${seed.toString(36).padStart(6, '0').slice(-6)}`;
}

export function blockDefaults(kind: BlockKind, id: string = newBlockId()): PrintBlock {
  const base = blockSchema.parse({ id, kind });
  switch (kind) {
    case 'text':
      return { ...base, text: 'Static text', size: 10 };
    case 'field':
      return { ...base, field: 'code', size: 10, bold: true };
    case 'barcode':
      return { ...base, field: 'code', height: 40, widthPct: 60, align: 'center' };
    case 'image':
      return { ...base, height: 40, widthPct: 30 };
    case 'divider':
      return { ...base, height: 2 };
    case 'spacer':
      return { ...base, height: 12 };
  }
}

export const blockKeyOf = (id: string): string => `${BLOCK_PREFIX}${id}`;
export const blockIdOf = (key: string): string | null =>
  key.startsWith(BLOCK_PREFIX) ? key.slice(BLOCK_PREFIX.length) : null;

export function bindableLabel(key: string, custom: readonly BindableField[] = []): string {
  return [...BINDABLE_FIELDS, ...custom].find((f) => f.key === key)?.label ?? key;
}

/** Short, human description of a block for the sections list. */
export function blockSummary(b: PrintBlock, custom: readonly BindableField[] = []): string {
  switch (b.kind) {
    case 'text':
      return b.text ? `"${b.text.length > 40 ? `${b.text.slice(0, 40)}…` : b.text}"` : 'Empty text';
    case 'field':
      return `${b.text}{${bindableLabel(b.field, custom)}}`;
    case 'barcode':
      return `${SYMBOLOGY_LABELS[b.symbology]} of ${bindableLabel(b.field, custom)}`;
    case 'image':
      return b.imageDataUrl ? 'Uploaded image' : 'Company logo';
    case 'divider':
      return 'Horizontal rule';
    case 'spacer':
      return `${b.height} pt gap`;
  }
}

export const layoutSchema = z
  .object({
    family: z.enum(['document', 'label']),
    paper: z.enum(PAPER_SIZES),
    font: z.enum(FONTS),
    fontSize: z.number().int().min(7, 'At least 7 pt').max(16, 'At most 16 pt'),
    logoPosition: z.enum(LOGO_POSITIONS),
    accentColor: hexColorSchema,
    title: z.string().trim().max(60, 'At most 60 characters'),
    footerText: z.string().trim().max(200, 'At most 200 characters'),
    sections: z
      .array(z.object({ key: z.string().max(30), enabled: z.boolean() }))
      .min(1)
      .max(12 + MAX_BLOCKS),
    columns: z.array(z.object({ key: z.string().max(30), enabled: z.boolean() })).max(12),
    /** Symbology of the built-in Barcode section. */
    barcodeType: z.enum(BARCODE_SYMBOLOGIES).default('code128'),
    /** Label printers only: PDF (browser print) or raw ZPL for Zebra printers. */
    labelLanguage: z.enum(LABEL_LANGUAGES).default('PDF'),
    /** Free blocks placed in the section flow by `block:<id>` entries. */
    blocks: z.array(blockSchema).max(MAX_BLOCKS, `At most ${MAX_BLOCKS} blocks`).default([]),
  })
  .superRefine((l, ctx) => {
    const label = l.family === 'label';
    if (label !== isLabelStock(l.paper))
      ctx.addIssue({
        code: 'custom',
        path: ['paper'],
        message: label ? 'Choose a label stock size' : 'Choose a document paper size',
      });
    const ids = new Set(l.blocks.map((b) => b.id));
    if (ids.size !== l.blocks.length)
      ctx.addIssue({ code: 'custom', path: ['blocks'], message: 'Block ids must be unique' });
    for (const sec of l.sections) {
      const id = blockIdOf(sec.key);
      if (id !== null && !ids.has(id))
        ctx.addIssue({ code: 'custom', path: ['sections'], message: 'A section points to a removed block' });
    }
  });

export type PrintoutLayout = z.output<typeof layoutSchema>;

export function familyOf(typeKey: string): LayoutFamily {
  return PRINT_TYPES.find((t) => t.key === typeKey)?.category === 'labels' ? 'label' : 'document';
}

/** Columns that make sense per type (pick lists show Location, packing shows Price…). */
export function columnsFor(typeKey: string): readonly ColumnDef[] {
  if (familyOf(typeKey) === 'label') return [];
  if (typeKey.includes('picking') || typeKey === 'resolution-job' || typeKey === 'job-content')
    return DOCUMENT_COLUMNS.filter((c) =>
      ['location', 'sku', 'description', 'lot', 'uom', 'qty'].includes(c.key),
    );
  if (typeKey.includes('billing') || typeKey === 'contract')
    return DOCUMENT_COLUMNS.filter((c) => ['sku', 'description', 'qty', 'price', 'total'].includes(c.key));
  return DOCUMENT_COLUMNS.filter((c) => c.key !== 'location');
}

export function sectionsFor(typeKey: string): readonly SectionDef[] {
  return familyOf(typeKey) === 'label' ? LABEL_SECTIONS : DOCUMENT_SECTIONS;
}

/* ---------------- base templates (wizard step 2) ---------------- */

export interface BaseTemplate {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly layout: (typeKey: string) => PrintoutLayout;
}

const docLayout = (
  typeKey: string,
  title: string,
  over: Partial<PrintoutLayout> = {},
  hiddenSections: readonly string[] = [],
  hiddenColumns: readonly string[] = [],
): PrintoutLayout => ({
  family: 'document',
  paper: 'Letter',
  font: 'Helvetica',
  fontSize: 10,
  logoPosition: 'left',
  accentColor: '#1F2A44',
  title,
  footerText: 'Thank you for your order.',
  barcodeType: 'code128',
  labelLanguage: 'PDF',
  blocks: [],
  sections: DOCUMENT_SECTIONS.map((s) => ({ key: s.key, enabled: !hiddenSections.includes(s.key) })),
  columns: columnsFor(typeKey).map((c) => ({ key: c.key, enabled: !hiddenColumns.includes(c.key) })),
  ...over,
});

const labelLayout = (title: string, paper: (typeof LABEL_STOCKS)[number]): PrintoutLayout => ({
  family: 'label',
  paper,
  font: 'Helvetica',
  fontSize: 10,
  logoPosition: 'hidden',
  accentColor: '#111827',
  title,
  footerText: '',
  barcodeType: 'code128',
  labelLanguage: 'PDF',
  blocks: [],
  sections: LABEL_SECTIONS.map((s) => ({ key: s.key, enabled: s.key !== 'logo' })),
  columns: [],
});

export const DOCUMENT_TEMPLATES: readonly BaseTemplate[] = [
  {
    key: 'standard',
    name: 'Standard',
    description: 'Logo left, addresses, full lines table and totals.',
    layout: (t) => docLayout(t, typeTitle(t)),
  },
  {
    key: 'compact',
    name: 'Compact',
    description: 'No logo or notes, smaller font, fits more lines per page.',
    layout: (t) => docLayout(t, typeTitle(t), { fontSize: 8, logoPosition: 'hidden' }, ['logo', 'notes']),
  },
  {
    key: 'retail',
    name: 'Retail (no prices)',
    description: 'Gift-friendly: prices and totals hidden, logo centered.',
    layout: (t) => docLayout(t, typeTitle(t), { logoPosition: 'center' }, ['totals'], ['price', 'total']),
  },
  {
    key: 'task',
    name: 'Task based',
    description: 'Barcode first and a location column, for pickers and packers.',
    layout: (t) => docLayout(t, typeTitle(t), { logoPosition: 'hidden' }, ['logo', 'totals']),
  },
];

export const LABEL_TEMPLATES: readonly BaseTemplate[] = [
  {
    key: 'label-4x6',
    name: '4 × 6 label',
    description: 'Large barcode with details, thermal 4 × 6.',
    layout: (t) => labelLayout(typeTitle(t), '4x6'),
  },
  {
    key: 'label-4x2',
    name: '4 × 2 label',
    description: 'Barcode and code only, thermal 4 × 2.',
    layout: (t) => ({
      ...labelLayout(typeTitle(t), '4x2'),
      sections: LABEL_SECTIONS.map((s) => ({ key: s.key, enabled: ['barcode', 'code'].includes(s.key) })),
    }),
  },
  {
    key: 'label-2x1',
    name: '2 × 1 label',
    description: 'Small product or bin sticker: barcode and code.',
    layout: (t) => ({
      ...labelLayout(typeTitle(t), '2x1'),
      fontSize: 8,
      sections: LABEL_SECTIONS.map((s) => ({ key: s.key, enabled: ['barcode', 'code'].includes(s.key) })),
    }),
  },
  {
    key: 'label-4x6-qr',
    name: '4 × 6 QR label',
    description: 'QR code with details, for scan-anywhere labels.',
    layout: (t) => ({ ...labelLayout(typeTitle(t), '4x6'), barcodeType: 'qrcode' }),
  },
];

/* ---------------- retailer-compliant packing lists ---------------- */

interface RetailerSpec {
  readonly key: string;
  readonly retailer: string;
  readonly accent: string;
  readonly description: string;
  /** Caption + bound field rows printed under the retailer header. */
  readonly fields: readonly (readonly [string, string])[];
  /** What the barcode encodes: the retailer's PO / order number or our order code. */
  readonly barcode: 'reference' | 'code';
  readonly footer: string;
}

/** Retailer packing list rules (drop-ship and store-ship guides): no prices, retailer PO barcode, return copy. */
export const RETAILER_SPECS: readonly RetailerSpec[] = [
  {
    key: 'target',
    retailer: 'Target',
    accent: '#CC0000',
    barcode: 'reference',
    description: 'Target.com drop-ship: Target PO barcode, no prices, Target return instructions.',
    fields: [
      ['Target PO #: ', 'reference'],
      ['Order date: ', 'date'],
      ['Ship via: ', 'carrier'],
    ],
    footer:
      'Return or exchange at any Target store or visit target.com/returns. Keep this packing slip for your records.',
  },
  {
    key: 'macys',
    retailer: "Macy's",
    accent: '#E21A2C',
    barcode: 'reference',
    description: "Macy's drop-ship: order number barcode, merchandise without prices, Macy's return policy.",
    fields: [
      ["Macy's order #: ", 'reference'],
      ['Order date: ', 'date'],
      ['Ship to: ', 'customerName'],
    ],
    footer:
      "Returns accepted within 90 days at any Macy's store or by mail with this packing slip. macys.com/returns",
  },
  {
    key: 'qvc',
    retailer: 'QVC',
    accent: '#6B2C91',
    barcode: 'reference',
    description: 'QVC vendor drop-ship: QVC order number, item list, QVC customer service copy.',
    fields: [
      ['QVC order #: ', 'reference'],
      ['Ship date: ', 'printedAt'],
      ['Carrier: ', 'carrier'],
    ],
    footer: 'Questions about your order? Call QVC Customer Service at 1-800-367-9444 or visit qvc.com.',
  },
  {
    key: 'staples',
    retailer: 'Staples Dropship',
    accent: '#CC0000',
    barcode: 'reference',
    description: 'Staples drop-ship: Staples PO barcode and vendor order code, no prices.',
    fields: [
      ['Staples PO #: ', 'reference'],
      ['Vendor order #: ', 'code'],
      ['Order date: ', 'date'],
    ],
    footer:
      'Thank you for shopping at Staples. For returns call 1-800-333-3330 or visit staples.com/returns.',
  },
  {
    key: 'walmart',
    retailer: 'Walmart',
    accent: '#0071CE',
    barcode: 'reference',
    description: 'Walmart.com drop-ship: customer order number barcode, no prices, Walmart returns copy.',
    fields: [
      ['Customer order #: ', 'reference'],
      ['Order date: ', 'date'],
      ['Ship method: ', 'carrier'],
    ],
    footer:
      'Return in store or start a return at walmart.com/returns. Have your customer order number ready.',
  },
  {
    key: 'amazon',
    retailer: 'Amazon',
    accent: '#232F3E',
    barcode: 'reference',
    description: 'Amazon (Seller Fulfilled / Prime) packing slip: order ID barcode, gift-safe, no prices.',
    fields: [
      ['Order ID: ', 'reference'],
      ['Order date: ', 'date'],
      ['Shipping service: ', 'carrier'],
    ],
    footer: 'Return or replace items in Your Orders at amazon.com/returns.',
  },
];

const retailerLayout = (typeKey: string, spec: RetailerSpec): PrintoutLayout => {
  const id = (n: number) => `r${spec.key.slice(0, 6)}${n}`;
  const head = blockSchema.parse({
    id: id(1),
    kind: 'text',
    text: spec.retailer,
    size: 18,
    bold: true,
    color: spec.accent,
  });
  const rows = spec.fields.map(([caption, field], i) =>
    blockSchema.parse({ id: id(i + 2), kind: 'field', text: caption, field, size: 10, bold: i === 0 }),
  );
  const bar = blockSchema.parse({
    id: id(9),
    kind: 'barcode',
    field: spec.barcode,
    symbology: 'code128',
    height: 36,
    widthPct: 55,
    align: 'left',
  });
  const keys = (bs: readonly PrintBlock[]) => bs.map((b) => ({ key: blockKeyOf(b.id), enabled: true }));
  const sections = [
    ...keys([head]),
    { key: 'header', enabled: true },
    ...keys(rows),
    ...keys([bar]),
    { key: 'addresses', enabled: true },
    { key: 'lines', enabled: true },
    { key: 'notes', enabled: true },
    { key: 'footer', enabled: true },
    { key: 'logo', enabled: false },
    { key: 'barcode', enabled: false },
    { key: 'totals', enabled: false },
  ];
  return {
    ...docLayout(
      typeKey,
      'Packing Slip',
      { logoPosition: 'hidden', accentColor: spec.accent, footerText: spec.footer },
      [],
      ['price', 'total', 'location'],
    ),
    sections,
    blocks: [head, ...rows, bar],
  };
};

export const RETAILER_TEMPLATES: readonly BaseTemplate[] = RETAILER_SPECS.map((spec) => ({
  key: `retailer-${spec.key}`,
  name: `${spec.retailer} packing list`,
  description: spec.description,
  layout: (t: string) => retailerLayout(t, spec),
}));

/** Packing list / slip types also offer the retailer-compliant set. */
export const isPackingType = (typeKey: string): boolean =>
  typeKey === 'packing-list' || typeKey === 'packing-slip';

export function templatesFor(typeKey: string): readonly BaseTemplate[] {
  if (familyOf(typeKey) === 'label') return LABEL_TEMPLATES;
  return isPackingType(typeKey) ? [...DOCUMENT_TEMPLATES, ...RETAILER_TEMPLATES] : DOCUMENT_TEMPLATES;
}

export function typeTitle(typeKey: string): string {
  return PRINT_TYPES.find((t) => t.key === typeKey)?.name ?? 'Printout';
}

/** Fills missing sections / columns (catalog grew) and drops unknown ones. */
export function normalizeLayout(typeKey: string, raw: unknown): PrintoutLayout {
  const base = templatesFor(typeKey)[0]!.layout(typeKey);
  const parsed = layoutSchema.safeParse(raw);
  if (!parsed.success) return base;
  const l = parsed.data;
  const known = sectionsFor(typeKey).map((s) => s.key);
  const blockIds = new Set(l.blocks.map((b) => b.id));
  const keep = (key: string) => known.includes(key) || blockIds.has(blockIdOf(key) ?? '');
  const sections = [
    ...l.sections.filter((s) => keep(s.key)),
    ...known.filter((k) => !l.sections.some((s) => s.key === k)).map((key) => ({ key, enabled: false })),
    // A block without a section entry still prints (appended, on).
    ...l.blocks
      .filter((b) => !l.sections.some((s) => s.key === blockKeyOf(b.id)))
      .map((b) => ({ key: blockKeyOf(b.id), enabled: true })),
  ];
  const knownCols = columnsFor(typeKey).map((c) => c.key);
  const columns = [
    ...l.columns.filter((c) => knownCols.includes(c.key)),
    ...knownCols.filter((k) => !l.columns.some((c) => c.key === k)).map((key) => ({ key, enabled: false })),
  ];
  return { ...l, family: familyOf(typeKey), sections, columns };
}

/** Moves item `index` by `delta` (designer up / down buttons). */
export function moveItem<T>(list: readonly T[], index: number, delta: number): T[] {
  const next = [...list];
  const target = index + delta;
  if (index < 0 || index >= next.length || target < 0 || target >= next.length) return next;
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item as T);
  return next;
}

/* ---------------- wizard ---------------- */

export const PRINTOUT_STATUSES = ['Active', 'Passive'] as const;

export const printoutInfoSchema = z.object({
  name: requiredText('Name', 80),
  description: requiredText('Description', 250),
  recordsPerPage: z.enum(PRINT_RECORDS_PER_PAGE, { error: 'Choose records per page' }),
  printMode: z.enum(PRINT_MODES, { error: 'Choose a print mode' }),
  printerType: z.enum(PRINTER_TYPES, { error: 'Choose a printer type' }),
  isActive: z.boolean(),
});

export const printoutTemplateStepSchema = z.object({ baseTemplate: z.string().min(1, 'Select a template') });
export const printoutDesignStepSchema = z.object({ layout: layoutSchema });

export const printoutOptionsSchema = z.object({
  useRetailerPackingList: z.boolean().default(false),
  groupBy: z.enum(['none', 'location', 'sku', 'zone']).default('none'),
  labelCopies: z.number().int().min(1).max(20).default(1),
});

export const printoutClientsStepSchema = z
  .object({ allClients: z.boolean(), clientIds: z.array(idField).max(5000) })
  .superRefine((v, ctx) => {
    if (!v.allClients && v.clientIds.length === 0)
      ctx.addIssue({
        code: 'custom',
        path: ['clientIds'],
        message: 'Give at least one client access, or give access to all clients',
      });
  });

export const printoutSchema = printoutInfoSchema
  .extend({
    typeKey: z
      .string()
      .min(1)
      .max(80)
      .refine((k) => PRINT_TYPES.some((t) => t.key === k), 'Unknown printout type'),
    baseTemplate: z.string().min(1, 'Select a template').max(40),
    layout: layoutSchema,
    options: printoutOptionsSchema,
    allClients: z.boolean(),
    clientIds: z.array(idField).max(5000).default([]),
    version: versionField,
  })
  .superRefine((v, ctx) => {
    if (!v.allClients && v.clientIds.length === 0)
      ctx.addIssue({
        code: 'custom',
        path: ['clientIds'],
        message: 'Give at least one client access, or give access to all clients',
      });
  });

export type PrintoutFormValues = z.input<typeof printoutSchema>;
export type PrintoutSave = z.output<typeof printoutSchema>;

export function printoutDefaults(typeKey: string): PrintoutFormValues {
  const type = PRINT_TYPES.find((t) => t.key === typeKey);
  const base = templatesFor(typeKey)[0]!;
  return {
    typeKey,
    name: '',
    description: '',
    recordsPerPage: familyOf(typeKey) === 'label' ? 'Single Record' : 'Multiple Records',
    printMode: 'PDF Preview',
    printerType: type?.printerType ?? 'Laser Printer',
    isActive: true,
    baseTemplate: base.key,
    layout: base.layout(typeKey),
    options: { useRetailerPackingList: false, groupBy: 'none', labelCopies: 1 },
    allClients: true,
    clientIds: [],
  };
}

/* ---------------- grid ---------------- */

export const PRINTOUT_FIELDS: readonly AdminField[] = [
  { field: 'name', label: 'Report name', type: 'text' },
  { field: 'description', label: 'Description', type: 'text' },
  { field: 'typeKey', label: 'Report type', type: 'enum', options: PRINT_TYPES.map((t) => t.key) },
  { field: 'status', label: 'Status', type: 'enum', options: PRINTOUT_STATUSES },
  { field: 'printMode', label: 'Print mode', type: 'enum', options: PRINT_MODES },
  { field: 'printerType', label: 'Printer type', type: 'enum', options: PRINTER_TYPES },
  { field: 'isDefault', label: 'Default', type: 'boolean' },
  { field: 'createdAt', label: 'Creation date', type: 'date' },
];

export const PRINTOUT_SORT_FIELDS = [
  'name',
  'description',
  'createdAt',
  'createdByName',
  'status',
  'typeKey',
  'printMode',
  'isDefault',
  'updatedAt',
] as const;
export const PRINTOUT_SEARCH_FIELDS = ['name', 'description'] as const;
