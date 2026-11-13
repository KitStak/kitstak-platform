/** Geometry and sample data for the rack map illustration. All values are SVG user units. */
export const AISLES = ['A', 'B', 'C', 'D'] as const;
export const BAYS = 10;
export const BIN_W = 40;
export const BIN_H = 30;
export const BIN_GAP = 4;
export const RACK_X = 96;
export const RACK_Y0 = 28;
export const ROW_PITCH = 78;
export const VIEW_W = RACK_X + BAYS * (BIN_W + BIN_GAP) + 24;
const DOCK_H = 52;
export const VIEW_H = RACK_Y0 + AISLES.length * ROW_PITCH + DOCK_H + 8;
/** Dock sits below the last aisle, left of the racks. */
export const DOCK = { x: 16, y: VIEW_H - DOCK_H - 4, w: 56, h: DOCK_H } as const;

export interface Bin {
  readonly id: string;
  readonly row: number;
  readonly bay: number;
  readonly x: number;
  readonly y: number;
  readonly sku: string;
  readonly qty: number;
}

const SKUS = ['KS-1001', 'KS-1042', 'KS-2210', 'KS-3150', 'KS-4007', 'KS-5120', 'KS-6031'];

export const BINS: readonly Bin[] = AISLES.flatMap((aisle, row) =>
  Array.from({ length: BAYS }, (_, bay) => ({
    id: `${aisle}-${String(bay + 1).padStart(2, '0')}`,
    row,
    bay,
    x: RACK_X + bay * (BIN_W + BIN_GAP),
    y: RACK_Y0 + row * ROW_PITCH,
    sku: SKUS[(row * 3 + bay * 7) % SKUS.length]!,
    qty: ((row + 3) * (bay + 5) * 37) % 480 + 12,
  })),
);

/** Each pick list is a set of bin ids, visited in the order given. */
export const PICK_LISTS: readonly (readonly string[])[] = [
  ['A-03', 'A-08', 'B-06', 'C-02', 'D-09'],
  ['B-02', 'B-10', 'C-05', 'C-07', 'D-03'],
  ['A-10', 'B-04', 'C-09', 'D-01', 'D-06'],
];

function binById(id: string): Bin {
  const bin = BINS.find((b) => b.id === id);
  if (!bin) throw new Error(`Unknown bin ${id}`);
  return bin;
}

/** Lane below a rack row, where the picker walks. */
function laneY(row: number): number {
  return RACK_Y0 + row * ROW_PITCH + BIN_H + (ROW_PITCH - BIN_H) / 2;
}

/** Orthogonal walk path from the dock through every bin in the list and back. */
export function pickPath(ids: readonly string[]): { d: string; stops: readonly Bin[] } {
  const stops = ids.map(binById);
  const start = { x: DOCK.x + DOCK.w, y: DOCK.y + DOCK.h / 2 };
  const crossX = RACK_X - 14;
  const parts = [`M ${start.x} ${start.y}`, `H ${crossX}`];
  for (const bin of stops) {
    const y = laneY(bin.row);
    parts.push(`V ${y}`, `H ${bin.x + BIN_W / 2}`, `V ${bin.y + BIN_H}`, `V ${y}`, `H ${crossX}`);
  }
  parts.push(`V ${start.y}`, `H ${start.x}`);
  return { d: parts.join(' '), stops };
}
