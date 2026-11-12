/**
 * Purchase-order plan for the history replay (pure: no DB access).
 *
 * 32 POs across both warehouses. The target status decides the timeline: Completed POs
 * arrived and were fully received, Receiving POs are part-way, Started POs are checked in
 * at the dock, Pending POs are still in transit and one PO was cancelled by the client.
 */
import type { PoStatus } from '@/lib/enums';
import type { Rng } from './seed-data';

export interface PoPlanProduct {
  readonly id: string;
  readonly price: number;
  readonly caseQty: number | null;
}

export interface PoPlanClient {
  readonly id: string;
  readonly vendorIds: readonly string[];
  readonly products: readonly PoPlanProduct[];
}

export interface PoLinePlan {
  readonly productId: string;
  readonly packType: 'primary' | 'Case';
  /** In pack units. */
  readonly orderedQty: number;
  readonly unitCost: number;
  /** Units received damaged (when > 0). */
  readonly damagedQty: number;
  /** Pack units received in a later, second receipt (0 = single receipt). */
  readonly secondReceiptQty: number;
}

export interface PoPlan {
  readonly key: number;
  readonly warehouse: 'MLT1' | 'KS2';
  readonly clientId: string;
  readonly vendorIndex: number;
  readonly status: PoStatus;
  readonly poType: 'Purchase Order' | 'Transfer Order' | 'Purchase Order- Non Crossdock';
  readonly createdDaysAgo: number;
  /** Days ago the truck arrives (negative = future). */
  readonly arrivalDaysAgo: number;
  readonly lines: readonly PoLinePlan[];
  /** One receipt is keyed wrong, cancelled and re-received. */
  readonly hasCancelledReceipt: boolean;
  readonly reference: string | null;
}

const STATUS_PLAN: readonly PoStatus[] = [
  ...Array<PoStatus>(14).fill('Completed'),
  ...Array<PoStatus>(5).fill('Receiving'),
  ...Array<PoStatus>(4).fill('Started'),
  ...Array<PoStatus>(7).fill('Pending'),
  'Cancelled',
];

function timeline(rng: Rng, status: PoStatus): { created: number; arrival: number } {
  switch (status) {
    case 'Completed': {
      const arrival = rng.int(2, 26);
      return { created: arrival + rng.int(4, 9), arrival };
    }
    case 'Receiving':
      return { created: rng.int(6, 12), arrival: rng.int(0, 2) };
    case 'Started':
      return { created: rng.int(5, 10), arrival: 0 };
    case 'Pending':
      return { created: rng.int(0, 6), arrival: -rng.int(2, 10) };
    default:
      return { created: rng.int(14, 20), arrival: -1 };
  }
}

function linesFor(rng: Rng, client: PoPlanClient, status: PoStatus, withDamage: boolean): PoLinePlan[] {
  const count = Math.min(client.products.length, rng.int(2, 5));
  const chosen = new Map<string, PoPlanProduct>();
  while (chosen.size < count) {
    const p = rng.pick(client.products);
    chosen.set(p.id, p);
  }
  return [...chosen.values()].map((p, i) => {
    const asCase = p.caseQty !== null && rng.chance(0.4);
    const orderedQty = asCase ? rng.int(4, 16) : rng.int(4, 30) * 12;
    const partial = status === 'Receiving' && i === 0;
    return {
      productId: p.id,
      packType: asCase ? 'Case' : 'primary',
      orderedQty,
      unitCost: Math.round(p.price * 0.42 * (asCase ? (p.caseQty ?? 1) : 1) * 100) / 100,
      damagedQty: withDamage && i === 0 && !asCase ? rng.int(2, 5) : 0,
      secondReceiptQty: partial ? Math.floor(orderedQty / 2) : 0,
    };
  });
}

export function buildPoPlans(
  rng: Rng,
  mlt1Clients: readonly PoPlanClient[],
  ks2Clients: readonly PoPlanClient[],
): PoPlan[] {
  const plans: PoPlan[] = STATUS_PLAN.map((status, i) => {
    const client = mlt1Clients[i % mlt1Clients.length];
    const { created, arrival } = timeline(rng, status);
    return {
      key: i + 1,
      warehouse: 'MLT1',
      clientId: client.id,
      vendorIndex: rng.int(0, Math.max(0, client.vendorIds.length - 1)),
      status,
      poType: rng.chance(0.1)
        ? 'Transfer Order'
        : rng.chance(0.1)
          ? 'Purchase Order- Non Crossdock'
          : 'Purchase Order',
      createdDaysAgo: created,
      arrivalDaysAgo: arrival,
      lines: linesFor(rng, client, status, status === 'Completed' && i % 7 === 3),
      hasCancelledReceipt: status === 'Receiving' && i === 15,
      reference: rng.chance(0.7) ? `REF-${rng.digits(6)}` : null,
    };
  });
  ks2Clients.slice(0, 2).forEach((client, i) => {
    const arrival = 6 + i * 7;
    plans.push({
      key: plans.length + 1,
      warehouse: 'KS2',
      clientId: client.id,
      vendorIndex: 0,
      status: 'Completed',
      poType: 'Transfer Order',
      createdDaysAgo: arrival + 3,
      arrivalDaysAgo: arrival,
      lines: linesFor(rng, client, 'Completed', false),
      hasCancelledReceipt: false,
      reference: `XFER-MLT1-${rng.digits(4)}`,
    });
  });
  return plans;
}
