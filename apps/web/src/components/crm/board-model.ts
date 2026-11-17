export type ViewKind = 'table' | 'kanban' | 'timeline';
export type Status = 'Lead' | 'Proposal' | 'Won';

export interface BoardItem {
  readonly name: string;
  readonly owner: string;
  readonly status: Status;
  readonly value: string;
  /** Timeline start and length, as a share (0-1) of the visible range. */
  readonly start: number;
  readonly span: number;
}

export interface Frame {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export const VIEWS: readonly { readonly kind: ViewKind; readonly label: string }[] = [
  { kind: 'table', label: 'Table' },
  { kind: 'kanban', label: 'Kanban' },
  { kind: 'timeline', label: 'Timeline' },
];

export const STATUSES: readonly Status[] = ['Lead', 'Proposal', 'Won'];

/** Label palette token per status (same tokens the CRM uses for status pills). */
export const STATUS_TOKEN: Readonly<Record<Status, string>> = {
  Lead: 'sky',
  Proposal: 'orange',
  Won: 'green',
};

export const ITEMS: readonly BoardItem[] = [
  { name: 'Northwind restock', owner: 'Dana R.', status: 'Won', value: '$48,200', start: 0, span: 0.34 },
  { name: 'Harbor & Pine kits', owner: 'Marcus T.', status: 'Proposal', value: '$31,750', start: 0.18, span: 0.4 },
  { name: 'Ridgeline returns', owner: 'Priya S.', status: 'Won', value: '$12,400', start: 0.3, span: 0.22 },
  { name: 'Summit Goods', owner: 'Dana R.', status: 'Lead', value: '$86,000', start: 0.46, span: 0.38 },
  { name: 'Cobalt Cycle launch', owner: 'Ari K.', status: 'Proposal', value: '$22,900', start: 0.58, span: 0.3 },
  { name: 'Lakeside Pantry', owner: 'Marcus T.', status: 'Lead', value: '$9,600', start: 0.7, span: 0.28 },
];

const TOP = 14; // percent reserved for headers
const ROW_H = 11;
const ROW_GAP = 3;
const COL_W = 32;
const COL_GAP = 2;
const CARD_H = 24;
const CARD_GAP = 3;

/** Position of every item for a view, as percentages of the board. */
export function layout(view: ViewKind): readonly Frame[] {
  if (view === 'table') {
    return ITEMS.map((_, i) => ({ x: 0, y: TOP + i * (ROW_H + ROW_GAP), w: 100, h: ROW_H }));
  }
  if (view === 'timeline') {
    return ITEMS.map((item, i) => ({
      x: item.start * 100,
      y: TOP + i * (ROW_H + ROW_GAP),
      w: item.span * 100,
      h: ROW_H,
    }));
  }
  const seen: Record<Status, number> = { Lead: 0, Proposal: 0, Won: 0 };
  return ITEMS.map((item) => {
    const col = STATUSES.indexOf(item.status);
    const k = seen[item.status]++;
    return { x: col * (COL_W + COL_GAP) + 1, y: TOP + k * (CARD_H + CARD_GAP), w: COL_W, h: CARD_H };
  });
}

export function columnX(index: number): number {
  return index * (COL_W + COL_GAP) + 1;
}
export const COLUMN_WIDTH = COL_W;
