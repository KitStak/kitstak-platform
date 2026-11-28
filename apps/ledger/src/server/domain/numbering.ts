/**
 * Document numbers (docs/ledger/SPEC.md 4.5.2). A number is taken with
 * `UPDATE ... SET next_value = next_value + 1 RETURNING` inside the posting transaction, so a
 * rolled back send leaves no gap. The org's sequences are made on first read (setup.ts).
 */
import 'server-only';
import { sql } from 'drizzle-orm';
import type { Transaction } from '@/server/db';
import { scoped } from '@/server/db/scope';
import { DomainError } from '@/server/errors';
import type { DocType } from '@/lib/ledger-enums';
import type { DomainContext } from './_shared';

/** `INV-1001`, or `JE-000042` with a pad of 6. */
export function formatNumber(prefix: string, value: number | bigint, pad: number): string {
  return `${prefix}${String(value).padStart(pad, '0')}`;
}

export const nextNumber = scoped(async function nextNumber(tx: Transaction, ctx: DomainContext, docType: DocType): Promise<string> {
  const result = await tx.execute<{ prefix: string; value: string; pad: number }>(
    sql`update ledger.number_sequences set next_value = next_value + 1, updated_at = now()
         where org_id = ${ctx.orgId}::uuid and doc_type = ${docType}
     returning prefix, (next_value - 1)::text as value, pad`,
  );
  const row = result.rows[0];
  if (!row) throw new DomainError('CONFLICT', 'Numbering is not set up for this workspace yet. Open Ledger once to set it up.');
  return formatNumber(row.prefix, BigInt(row.value), row.pad);
}, 1);
