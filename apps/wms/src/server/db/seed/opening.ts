/**
 * Opening balance: the stock on hand before the replay window, posted
 * through the ledger as Inventory Adjustments with the "Opening Balance" reason
 * (serial-tracked SKUs go through Add Inventory receipts so every unit has a serial).
 */
import { ledger } from '@/server/domain';
import type { Tx } from '@/server/domain/types';
import type { ProductRef } from './catalog';
import { SCARCE_SKUS } from './catalog-data';
import type { LpRef, WarehouseFacility } from './facility';
import { lookupId } from './lookups';
import { DAY_MS, dateOf, isoOf } from './runtime';
import type { Id } from './types';
import { adminCtx, type World } from './world';

const MIGRATION_NOTE = 'Opening balance';

export const lotCode = (ms: number, n: number): string =>
  `L${dateOf(ms).slice(2).replaceAll('-', '')}${String.fromCharCode(65 + (n % 26))}`;
export const expiryFor = (receivedMs: number, shelfLifeDays = 270): string =>
  dateOf(receivedMs + shelfLifeDays * DAY_MS);

let serialCounter = 0;
export function nextSerials(sku: string, count: number): { primary: string }[] {
  const prefix = sku.replace(/[^A-Z0-9]/g, '').slice(0, 6);
  return Array.from({ length: count }, () => {
    serialCounter += 1;
    return { primary: `${prefix}${String(260_000 + serialCounter).padStart(7, '0')}` };
  });
}
export function resetSerials(): void {
  serialCounter = 0;
}

interface Slot {
  readonly locationId: Id;
  readonly lp: LpRef | null;
  readonly qty: number;
  readonly lot: string | null;
  readonly expiry: string | null;
  readonly receivedMs: number;
}

function slotsFor(
  w: World,
  fac: WarehouseFacility,
  p: ProductRef,
  cursor: { reserve: number; pallet: number },
  scale: number,
  atMs: number,
): Slot[] {
  const rng = w.env.rng;
  const face = fac.pickFaces.get(p.id) ?? null;
  const lotOf = (n: number, ms: number) => (p.trackLot ? lotCode(ms, n) : null);
  const expOf = (ms: number) => (p.trackLot ? expiryFor(ms) : null);
  const recv = (daysBack: number) => atMs - daysBack * DAY_MS;
  if (SCARCE_SKUS.has(p.sku))
    return face
      ? [
          {
            locationId: face,
            lp: null,
            qty: 3,
            lot: lotOf(0, recv(60)),
            expiry: expOf(recv(60)),
            receivedMs: recv(60),
          },
        ]
      : [];
  if (p.kitType === 'Kit to Stock')
    return face
      ? [{ locationId: face, lp: null, qty: 8, lot: null, expiry: null, receivedMs: recv(20) }]
      : [];
  const nextReserve = (): Id => fac.reserve[cursor.reserve++ % fac.reserve.length];
  if (p.isPackaging)
    return [
      {
        locationId: nextReserve(),
        lp: null,
        qty: rng.int(1500, 3000),
        lot: null,
        expiry: null,
        receivedMs: recv(45),
      },
    ];
  const out: Slot[] = [];
  const serialScale = p.trackSerial ? 0.25 : 1;
  if (face) {
    const ms = recv(rng.int(15, 40));
    out.push({
      locationId: face,
      lp: null,
      qty: Math.max(4, Math.round(rng.int(24, 60) * scale * serialScale)),
      lot: lotOf(1, ms),
      expiry: expOf(ms),
      receivedMs: ms,
    });
  }
  const reserveCount = face ? (rng.chance(0.3) ? 2 : 1) : 2;
  for (let i = 0; i < reserveCount; i += 1) {
    const ms = recv(rng.int(5, 60));
    const onPallet = !p.trackSerial && cursor.pallet < fac.pallets.length - 14 && rng.chance(0.55);
    out.push({
      locationId: nextReserve(),
      lp: onPallet ? fac.pallets[cursor.pallet++] : null,
      qty: Math.max(10, Math.round(rng.int(140, 320) * scale * serialScale)),
      lot: lotOf(2 + i, ms),
      expiry: expOf(ms),
      receivedMs: ms,
    });
  }
  return out;
}

async function postSlot(
  w: World,
  tx: Tx,
  fac: WarehouseFacility,
  p: ProductRef,
  s: Slot,
  reasonId: Id,
): Promise<void> {
  const ctx = adminCtx(w);
  if (p.trackSerial) {
    await ledger.recordReceipt(tx, ctx, {
      type: 'Add Inventory',
      warehouseId: fac.id,
      clientId: p.clientId,
      productId: p.id,
      quantity: s.qty,
      locationId: s.locationId,
      lpId: s.lp?.id ?? null,
      note: MIGRATION_NOTE,
      serials: nextSerials(p.sku, s.qty),
    });
    return;
  }
  await ledger.add(tx, ctx, {
    warehouseId: fac.id,
    clientId: p.clientId,
    productId: p.id,
    locationId: s.locationId,
    lpId: s.lp?.id ?? null,
    lotNumber: s.lot,
    expiryDate: s.expiry,
    packType: p.uom,
    qty: s.qty,
    receivedAt: isoOf(s.receivedMs),
    refs: { adjustmentReasonId: reasonId, note: MIGRATION_NOTE },
  });
}

/** Posts the opening balance for both warehouses. Returns the number of buckets created. */
export async function postOpeningBalance(w: World, tx: Tx, atMs: number): Promise<number> {
  const reasonId = lookupId(w.lookups, 'adjustment_reason', 'Opening Balance');
  let buckets = 0;
  for (const fac of [w.facility.MLT1, w.facility.KS2]) {
    const cursor = { reserve: 0, pallet: 0 };
    const scale = fac.code === 'MLT1' ? 1 : 0.45;
    for (const p of fac.products) {
      for (const slot of slotsFor(w, fac, p, cursor, scale, atMs)) {
        await postSlot(w, tx, fac, p, slot, reasonId);
        buckets += 1;
      }
    }
  }
  return buckets;
}
