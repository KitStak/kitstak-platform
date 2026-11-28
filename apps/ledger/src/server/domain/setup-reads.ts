/**
 * Readers for the Settings screens that have data from the first read: the chart of accounts,
 * terms, numbering, reminders and people with their Ledger roles. Every export is scoped.
 */
import 'server-only';
import { asc, eq, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { accounts, numberSequences, reminderRules, terms } from '@/server/db/schema';
import { scoped } from '@/server/db/scope';
import type { LedgerAccess } from '@kitstak/ledger-bridge/types';
import { listMemberAccess } from './access';
import type { DomainContext } from './_shared';
import { formatNumber } from './numbering';

export const listAccounts = scoped(async function listAccounts(ctx: DomainContext) {
  return db
    .select({ id: accounts.id, number: accounts.number, name: accounts.name, type: accounts.type, systemKey: accounts.systemKey, archivedAt: accounts.archivedAt })
    .from(accounts)
    .where(eq(accounts.orgId, ctx.orgId))
    .orderBy(asc(accounts.number));
});

export const listTerms = scoped(async function listTerms(ctx: DomainContext) {
  return db.select({ id: terms.id, name: terms.name, isDefault: terms.isDefault, active: terms.active }).from(terms).where(eq(terms.orgId, ctx.orgId)).orderBy(asc(terms.name));
});

export const listNumbering = scoped(async function listNumbering(ctx: DomainContext) {
  const rows = await db.select().from(numberSequences).where(eq(numberSequences.orgId, ctx.orgId)).orderBy(asc(numberSequences.docType));
  return rows.map((row) => ({ docType: row.docType, next: formatNumber(row.prefix, row.nextValue, row.pad) }));
});

export const listReminderRules = scoped(async function listReminderRules(ctx: DomainContext) {
  return db.select({ id: reminderRules.id, offsetDays: reminderRules.offsetDays, repeatEveryDays: reminderRules.repeatEveryDays, subject: reminderRules.subject }).from(reminderRules).where(eq(reminderRules.orgId, ctx.orgId)).orderBy(asc(reminderRules.offsetDays));
});

export interface PersonWithAccess {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly access: LedgerAccess;
}

export const listPeople = scoped(async function listPeople(ctx: DomainContext): Promise<readonly PersonWithAccess[]> {
  const members = await listMemberAccess(ctx);
  const result = await db.execute<{ id: string; name: string; email: string }>(
    sql`select u.id, u.name, u.email from core.member m join core."user" u on u.id = m.user_id where m.organization_id = ${ctx.orgId}::uuid order by lower(u.name)`,
  );
  const byId = new Map(members.map((member) => [member.userId, member.access]));
  return result.rows.flatMap((row) => {
    const access = byId.get(row.id);
    return access ? [{ userId: row.id, name: row.name, email: row.email, access }] : [];
  });
});
