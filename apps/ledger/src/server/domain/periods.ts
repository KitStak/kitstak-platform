/** Months and their close state (docs/ledger/SPEC.md 4.11). Readers only in Phase 0. */
import 'server-only';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/server/db';
import { periods } from '@/server/db/schema';
import { scoped } from '@/server/db/scope';
import type { DomainContext } from './_shared';

export interface PeriodRow {
  readonly periodMonth: string;
  readonly status: 'open' | 'closed';
}

export const listPeriods = scoped(async function listPeriods(ctx: DomainContext): Promise<readonly PeriodRow[]> {
  return db.select({ periodMonth: periods.periodMonth, status: periods.status }).from(periods).where(eq(periods.orgId, ctx.orgId)).orderBy(desc(periods.periodMonth));
});
