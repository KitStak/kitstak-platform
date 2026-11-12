/** Location layouts for both warehouses (pure data builders). */
import type { ABC_CODES, AREA_TYPES, LEGACY_LOCATION_ROLES, LOCATION_TYPES } from '@/lib/enums';

export type WarehouseCode = 'MLT1' | 'KS2';

export interface LocationDef {
  readonly code: string;
  readonly zone: string;
  readonly aisle: string;
  readonly bay: string;
  readonly level: string;
  readonly legacyType: (typeof LEGACY_LOCATION_ROLES)[number];
  readonly areaType: (typeof AREA_TYPES)[number];
  readonly locationType: (typeof LOCATION_TYPES)[number];
  readonly group: string;
  readonly abc: (typeof ABC_CODES)[number];
  readonly replenishmentType: 'Source' | 'Target' | null;
  readonly capacityUnits: number;
  readonly dims: readonly [number, number, number];
  readonly onlyDamaged?: boolean;
  readonly isLocked?: boolean;
}

interface GridSpec {
  readonly zone: string;
  readonly aisles: number;
  readonly bays: number;
  readonly levels: number;
  readonly role: 'pick' | 'reserve';
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

function grid(spec: GridSpec): LocationDef[] {
  const out: LocationDef[] = [];
  for (let a = 1; a <= spec.aisles; a += 1) {
    for (let b = 1; b <= spec.bays; b += 1) {
      for (let lv = 1; lv <= spec.levels; lv += 1) {
        const pick = spec.role === 'pick';
        out.push({
          code: `${spec.zone}-${pad2(a)}-${pad2(b)}-${lv}`,
          zone: spec.zone,
          aisle: pad2(a),
          bay: pad2(b),
          level: String(lv),
          legacyType: pick ? 'Picking' : 'Reserve',
          areaType: pick ? 'Picking' : 'Storage',
          locationType: pick ? 'Shelves' : 'Racks',
          group: pick
            ? spec.zone === 'A' || spec.zone === 'E'
              ? 'Fast Movers'
              : 'Shelving'
            : 'Pallet Racking',
          abc: pick ? (spec.zone === 'A' || spec.zone === 'E' ? 'A' : 'B') : 'C',
          replenishmentType: pick ? 'Target' : 'Source',
          capacityUnits: pick ? 80 : 240,
          dims: pick ? [36, 18, 14] : [48, 42, 52],
        });
      }
    }
  }
  return out;
}

const dock = (
  code: string,
  legacyType: LocationDef['legacyType'],
  areaType: LocationDef['areaType'],
  locationType: LocationDef['locationType'],
  extra: Partial<LocationDef> = {},
): LocationDef => ({
  code,
  zone: 'Dock',
  aisle: '00',
  bay: '00',
  level: '1',
  legacyType,
  areaType,
  locationType,
  group: 'Dock & Staging',
  abc: 'None',
  replenishmentType: null,
  capacityUnits: 600,
  dims: [96, 96, 96],
  ...extra,
});

const bulk = (code: string): LocationDef => ({
  code,
  zone: 'Bulk',
  aisle: '00',
  bay: code.slice(-2),
  level: '1',
  legacyType: 'Reserve',
  areaType: 'Storage',
  locationType: 'Ramps',
  group: 'Bulk Floor',
  abc: 'C',
  replenishmentType: 'Source',
  capacityUnits: 1200,
  dims: [48, 40, 72],
});

export const DEFAULT_LOCATIONS: Readonly<Record<WarehouseCode, { recv: string; ship: string; rtn: string }>> =
  {
    MLT1: { recv: 'MLT1-RECV', ship: 'MLT1-SHIP', rtn: 'MLT1-RTN' },
    KS2: { recv: 'KS2-RECV', ship: 'KS2-SHIP', rtn: 'KS2-RTN' },
  };

export const PACK_STATIONS: Readonly<Record<WarehouseCode, readonly string[]>> = {
  MLT1: ['PACK-01', 'PACK-02', 'PACK-03', 'PACK-04'],
  KS2: ['PACK-01', 'PACK-02'],
};

export const LOCKED_LOCATION = 'D-04-05-3';

export function locationsFor(wh: WarehouseCode): LocationDef[] {
  const d = DEFAULT_LOCATIONS[wh];
  if (wh === 'MLT1') {
    return [
      ...grid({ zone: 'A', aisles: 4, bays: 5, levels: 3, role: 'pick' }),
      ...grid({ zone: 'B', aisles: 4, bays: 5, levels: 3, role: 'pick' }),
      ...grid({ zone: 'C', aisles: 4, bays: 5, levels: 3, role: 'reserve' }),
      ...grid({ zone: 'D', aisles: 4, bays: 5, levels: 3, role: 'reserve' }).map((l) =>
        l.code === LOCKED_LOCATION ? { ...l, isLocked: true } : l,
      ),
      ...['BULK-01', 'BULK-02', 'BULK-03', 'BULK-04', 'BULK-05', 'BULK-06'].map(bulk),
      dock(d.recv, 'Receiving', 'Receiving', 'Virtual'),
      dock('RECV-01', 'Receiving', 'Receiving', 'Ramps'),
      dock('RECV-02', 'Receiving', 'Receiving', 'Ramps'),
      dock('RECV-03', 'Receiving', 'Receiving', 'Ramps'),
      dock(d.ship, 'Shipping', 'Shipment', 'Virtual'),
      dock('SHIP-01', 'Shipping', 'Shipment', 'Ramps'),
      dock('SHIP-02', 'Shipping', 'Shipment', 'Ramps'),
      dock('SHIP-03', 'Shipping', 'Shipment', 'Ramps'),
      dock(d.rtn, 'Returns', 'Returns', 'Virtual'),
      dock('RET-01', 'Returns', 'Returns', 'Shelves'),
      dock('RET-02', 'Returns', 'Returns', 'Shelves'),
      dock('DMG-01', 'Damaged', 'Storage', 'Shelves', { onlyDamaged: true, capacityUnits: 200 }),
      ...PACK_STATIONS.MLT1.map((c) =>
        dock(c, 'Shipping', 'Packing', 'BusinessStation', { capacityUnits: 400 }),
      ),
      dock('KIT-01', 'Reserve', 'Kitting', 'BusinessStation', { capacityUnits: 400 }),
      dock('LOAD-01', 'Shipping', 'Loading', 'Ramps'),
      dock('LOAD-02', 'Shipping', 'Loading', 'Ramps'),
    ];
  }
  return [
    ...grid({ zone: 'E', aisles: 2, bays: 5, levels: 3, role: 'pick' }),
    ...grid({ zone: 'F', aisles: 2, bays: 5, levels: 3, role: 'reserve' }),
    ...['BULK-01', 'BULK-02', 'BULK-03', 'BULK-04'].map(bulk),
    dock(d.recv, 'Receiving', 'Receiving', 'Virtual'),
    dock(d.ship, 'Shipping', 'Shipment', 'Virtual'),
    dock(d.rtn, 'Returns', 'Returns', 'Virtual'),
    ...PACK_STATIONS.KS2.map((c) =>
      dock(c, 'Shipping', 'Packing', 'BusinessStation', { capacityUnits: 400 }),
    ),
    dock('LOAD-01', 'Shipping', 'Loading', 'Ramps'),
  ];
}

/** Clients whose overflow stock lives in KS2. */
export const KS2_CLIENTS: readonly string[] = ['APX', 'SMT', 'NVF'];

export interface PackageDef {
  readonly code: string;
  readonly description: string;
  readonly dims: readonly [number, number, number];
  readonly emptyWeightLb: number;
  readonly maxWeightLb: number;
  readonly price: number;
  readonly trackedSku?: string;
}

export const PACKAGES: readonly PackageDef[] = [
  {
    code: 'ENV-POLY-1013',
    description: 'Poly mailer envelope 10x13',
    dims: [13, 10, 1],
    emptyWeightLb: 0.04,
    maxWeightLb: 4,
    price: 0.38,
  },
  {
    code: 'ENV-PAD-0609',
    description: 'Padded envelope 6x9',
    dims: [9, 6, 1],
    emptyWeightLb: 0.06,
    maxWeightLb: 2,
    price: 0.52,
  },
  {
    code: 'BOX-S-0806',
    description: 'Small box 8x6x4',
    dims: [8, 6, 4],
    emptyWeightLb: 0.3,
    maxWeightLb: 20,
    price: 0.74,
  },
  {
    code: 'BOX-M-1210',
    description: 'Medium box 12x10x6 (inventory tracked)',
    dims: [12, 10, 6],
    emptyWeightLb: 0.5,
    maxWeightLb: 35,
    price: 1.1,
    trackedSku: 'VLT-PKG-BOX-12106',
  },
  {
    code: 'BOX-L-1612',
    description: 'Large box 16x12x10',
    dims: [16, 12, 10],
    emptyWeightLb: 0.9,
    maxWeightLb: 50,
    price: 1.65,
  },
  {
    code: 'BOX-XL-2016',
    description: 'Extra-large box 20x16x14',
    dims: [20, 16, 14],
    emptyWeightLb: 1.4,
    maxWeightLb: 65,
    price: 2.4,
  },
  {
    code: 'BOX-CF-0909',
    description: 'Coffee gift box 9x9x4',
    dims: [9, 9, 4],
    emptyWeightLb: 0.35,
    maxWeightLb: 10,
    price: 0.95,
  },
  {
    code: 'CTN-B2B-2418',
    description: 'B2B master carton 24x18x18',
    dims: [24, 18, 18],
    emptyWeightLb: 2.1,
    maxWeightLb: 70,
    price: 3.2,
  },
];

export const KS2_PACKAGES: readonly string[] = ['BOX-S-0806', 'BOX-M-1210', 'BOX-L-1612'];
