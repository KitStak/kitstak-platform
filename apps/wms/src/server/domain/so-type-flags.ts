/**
 * Shipment Order Type behaviours (Data Setup › Shipment Order Type, `lookup_values.meta.flags`)
 * as read by the runtime: the order's `orderTypeId` → its switched-on flag keys.
 * Orders without a type, or with a type that has no flags, behave as before (every switch No).
 */
import { eq } from 'drizzle-orm';
import * as schema from '@/server/db/schema';
import type { Tx } from './types';

/** `meta.flags` is stored as { flagKey: true | false } (Data Setup drawer); an array of keys is accepted too. */
export function soTypeFlagsOf(meta: unknown): ReadonlySet<string> {
  const flags = (meta as { flags?: unknown } | null)?.flags;
  if (Array.isArray(flags)) return new Set(flags.filter((f): f is string => typeof f === 'string'));
  if (flags && typeof flags === 'object')
    return new Set(
      Object.entries(flags as Record<string, unknown>)
        .filter(([, v]) => v === true)
        .map(([k]) => k),
    );
  return new Set();
}

export async function orderTypeFlags(
  tx: Tx,
  orderTypeId: string | null | undefined,
): Promise<ReadonlySet<string>> {
  if (!orderTypeId) return new Set();
  const row = (
    await tx
      .select({ meta: schema.lookupValues.meta, type: schema.lookupValues.type })
      .from(schema.lookupValues)
      .where(eq(schema.lookupValues.id, orderTypeId))
      .limit(1)
  )[0];
  return row?.type === 'so_type' ? soTypeFlagsOf(row.meta) : new Set();
}
