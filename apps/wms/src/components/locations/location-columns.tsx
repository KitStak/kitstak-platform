'use client';

/** Locations grid columns: Logiwa's 21 plus Volume, ABC code, Dedicated client and Stored units. Default visible per BUILD_PLAN M10. */
import * as React from 'react';
import { Lock } from 'lucide-react';
import { LinkCell, type GridColumnDef } from '@/components/grid';
import { splitCamel } from '@/lib/grid-defs/facility/common';
import type { LocationRow } from '@/server/repositories/locations';
import { AvailabilityPill, Muted, Num, LockedPill, YesNo } from '@/components/facility/facility-shared';

const text = (v: string | null | undefined) => (v ? v : <Muted />);
const hidden = { defaultVisible: false } as const;
const VOLUME_ABBR: Readonly<Record<string, string>> = {
  'Cubic Inch': 'in³',
  'Cubic Foot': 'ft³',
  'Cubic Centimeter': 'cm³',
  'Cubic Meter': 'm³',
  Liter: 'L',
  Gallon: 'gal',
};

export const LOCATION_COLUMNS: GridColumnDef<LocationRow>[] = [
  {
    id: 'code',
    header: 'Location code',
    size: 170,
    meta: { alwaysVisible: true },
    cell: ({ row }) => (
      <span className="flex min-w-0 items-center gap-1.5">
        <LinkCell href={`/locations/${row.original.id}`}>{row.original.code}</LinkCell>
        {row.original.isLocked ? (
          <Lock className="h-3 w-3 shrink-0 text-warning" aria-label="Locked" />
        ) : null}
      </span>
    ),
  },
  {
    id: 'displayMember',
    header: 'Cell display member',
    size: 150,
    meta: hidden,
    cell: ({ row }) => text(row.original.displayMember),
  },
  {
    id: 'barcode',
    header: 'Location barcode',
    size: 150,
    meta: hidden,
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.barcode}</span>,
  },
  {
    id: 'warehouseCode',
    header: 'Warehouse',
    size: 100,
    meta: hidden,
    cell: ({ row }) => row.original.warehouseCode,
  },
  {
    id: 'locationGroup',
    header: 'Location group',
    size: 140,
    cell: ({ row }) => text(row.original.locationGroup),
  },
  {
    id: 'locationZone',
    header: 'Location zone',
    size: 120,
    cell: ({ row }) => text(row.original.locationZone),
  },
  {
    id: 'locationType',
    header: 'Location type',
    size: 130,
    cell: ({ row }) => text(row.original.locationType ? splitCamel(row.original.locationType) : null),
  },
  {
    id: 'replenishmentType',
    header: 'Replenishment type',
    size: 150,
    meta: hidden,
    cell: ({ row }) => text(row.original.replenishmentType),
  },
  { id: 'areaType', header: 'Area type', size: 110, cell: ({ row }) => text(row.original.areaType) },
  {
    id: 'assignedMobileCart',
    header: 'Assigned mobile cart',
    size: 150,
    meta: hidden,
    cell: ({ row }) => text(row.original.assignedMobileCart),
  },
  {
    id: 'walkingPathPriority',
    header: () => (
      <span title="Walking path priority: pick-path sequence, lower is visited first">Walking path</span>
    ),
    size: 110,
    meta: { align: 'right', label: 'Walking path priority' },
    cell: ({ row }) => (
      <div className="text-right">
        <Num value={row.original.walkingPathPriority} />
      </div>
    ),
  },
  { id: 'level', header: 'Level', size: 70, meta: hidden, cell: ({ row }) => text(row.original.level) },
  {
    id: 'mezzanine',
    header: 'Mezzanine',
    size: 100,
    meta: hidden,
    cell: ({ row }) => text(row.original.mezzanine),
  },
  { id: 'aisle', header: 'Aisle', size: 70, meta: hidden, cell: ({ row }) => text(row.original.aisle) },
  { id: 'rack', header: 'Rack', size: 70, meta: hidden, cell: ({ row }) => text(row.original.rack) },
  {
    id: 'position',
    header: 'Position',
    size: 80,
    meta: hidden,
    cell: ({ row }) => text(row.original.position),
  },
  {
    id: 'column',
    header: 'Column',
    size: 80,
    meta: { ...hidden, align: 'right' },
    cell: ({ row }) => (
      <div className="text-right">
        <Num value={row.original.column} />
      </div>
    ),
  },
  {
    id: 'height',
    header: 'Height',
    size: 80,
    meta: { ...hidden, align: 'right' },
    cell: ({ row }) => (
      <div className="text-right">
        <Num value={row.original.height} decimals={2} />
      </div>
    ),
  },
  {
    id: 'volume',
    header: 'Volume',
    size: 110,
    meta: { ...hidden, align: 'right' },
    cell: ({ row }) => (
      <div className="text-right">
        {row.original.volume > 0 ? (
          <Num
            value={row.original.volume}
            decimals={2}
            unit={VOLUME_ABBR[row.original.volumeUnit] ?? row.original.volumeUnit}
          />
        ) : (
          <Muted />
        )}
      </div>
    ),
  },
  {
    id: 'abcCode',
    header: 'ABC code',
    size: 90,
    meta: hidden,
    cell: ({ row }) => text(row.original.abcCode === 'None' ? null : row.original.abcCode),
  },
  {
    id: 'dedicatedClient',
    header: 'Dedicated client',
    size: 160,
    meta: hidden,
    cell: ({ row }) => text(row.original.dedicatedClient),
  },
  {
    id: 'isLocked',
    header: 'Locked',
    size: 80,
    meta: hidden,
    cell: ({ row }) => <LockedPill value={row.original.isLocked} />,
  },
  {
    id: 'inventoryStatus',
    header: 'Inventory status',
    size: 130,
    meta: { clip: false },
    cell: ({ row }) => <AvailabilityPill status={row.original.inventoryStatus} />,
  },
  {
    id: 'preventAllocation',
    header: 'Prevent allocation',
    size: 140,
    meta: hidden,
    cell: ({ row }) => <YesNo value={row.original.preventAllocation} />,
  },
  {
    id: 'storedUnits',
    header: 'Stored units',
    size: 110,
    meta: { ...hidden, align: 'right' },
    cell: ({ row }) => (
      <div className="text-right">
        <Num value={row.original.storedUnits} />
      </div>
    ),
  },
];
