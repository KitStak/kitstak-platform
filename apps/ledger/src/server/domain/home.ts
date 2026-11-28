/**
 * The Money home headline (docs/ledger/SPEC.md 6): what customers owe and what you owe, read from
 * the books (`account_month_totals` of the AR and AP system accounts). Cents leave as strings.
 */
import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { scoped } from '@/server/db/scope';
import type { DomainContext } from './_shared';

export interface MoneyHeadline {
  /** Debit balance of AR, whole cents as a decimal string. */
  readonly owedToYouCents: string;
  /** Credit balance of AP, whole cents as a decimal string. */
  readonly youOweCents: string;
}

export const moneyHeadline = scoped(async function moneyHeadline(ctx: DomainContext): Promise<MoneyHeadline> {
  const result = await db.execute<{ ar: string | null; ap: string | null }>(
    sql`select
          (select coalesce(sum(t.debit_cents - t.credit_cents), 0)::text from ledger.account_month_totals t join ledger.accounts a on a.id = t.account_id
            where t.org_id = ${ctx.orgId}::uuid and a.system_key = 'ar') as ar,
          (select coalesce(sum(t.credit_cents - t.debit_cents), 0)::text from ledger.account_month_totals t join ledger.accounts a on a.id = t.account_id
            where t.org_id = ${ctx.orgId}::uuid and a.system_key = 'ap') as ap`,
  );
  const row = result.rows[0];
  return { owedToYouCents: row?.ar ?? '0', youOweCents: row?.ap ?? '0' };
});
