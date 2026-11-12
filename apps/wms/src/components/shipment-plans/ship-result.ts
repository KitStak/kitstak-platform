/** Pure helpers behind the Ship result window (unit-tested in tests/unit/shipping). */
import type { ShipPlansResult } from '@/server/repositories/shipment-plans';

export interface ShipResultRow {
  readonly planCode: string;
  readonly orderCode: string | null;
  readonly ok: boolean;
  readonly description: string;
}

/** Flattens a ship result into one row per order (plus plan-level failures such as "no orders"). */
export function shipResultRows(
  result: ShipPlansResult,
  planCodes: ReadonlyMap<string, string>,
): readonly ShipResultRow[] {
  const rows: ShipResultRow[] = [];
  for (const o of result.outcomes) {
    for (const code of o.shipped)
      rows.push({ planCode: o.planCode, orderCode: code, ok: true, description: 'Shipped' });
    for (const f of o.failed)
      rows.push({
        planCode: o.planCode,
        orderCode: f.orderCode,
        ok: false,
        description: stripCode(f.message, f.orderCode),
      });
  }
  const withOutcome = new Set(result.outcomes.map((o) => o.planId));
  for (const f of result.failed) {
    if (f.code === 'PARTIAL' || withOutcome.has(f.id)) continue;
    const planCode = planCodes.get(f.id) ?? 'Plan';
    rows.push({ planCode, orderCode: null, ok: false, description: stripCode(f.message, planCode) });
  }
  return rows;
}

/** Status changes the ship caused ("Plan moved from Open to Loading Started …"), prefixed with the plan code when several plans shipped. */
export function shipStatusNotes(result: ShipPlansResult): readonly string[] {
  const multi = result.outcomes.length > 1;
  const status = result.outcomes
    .filter((o) => o.statusNote)
    .map((o) => (multi ? `${o.planCode}: ${o.statusNote}` : (o.statusNote as string)));
  return [...status, ...result.outcomes.flatMap((o) => o.manifestWarnings ?? [])];
}

/** Drops a leading "CODE: " and the trailing full stop so the table reads cleanly. */
function stripCode(message: string, code: string): string {
  const prefix = `${code}: `;
  const trimmed = message.startsWith(prefix) ? message.slice(prefix.length) : message;
  return trimmed.replace(/\.$/, '');
}

export function shipResultTitle(rows: readonly ShipResultRow[]): string {
  const errors = rows.filter((r) => !r.ok).length;
  if (rows.length === 0) return 'Nothing was shipped';
  if (errors === 0) return rows.length === 1 ? 'The order was shipped' : 'All orders shipped';
  return errors === rows.length ? 'No orders could be shipped' : 'Some orders couldn’t be shipped';
}
