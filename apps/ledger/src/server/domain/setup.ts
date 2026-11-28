/**
 * Made on first read (docs/ledger/SPEC.md 4): the settings row, the default chart of accounts,
 * the payment terms, the numbering and the reminder schedule. Idempotent and safe when two
 * requests arrive at once (one transaction under an advisory lock, every insert ON CONFLICT DO
 * NOTHING). Called by the shell before any page reads Ledger data.
 */
import 'server-only';
import { eq, sql } from 'drizzle-orm';
import { db, type Executor } from '@/server/db';
import { accounts, numberSequences, reminderRules, settings, terms } from '@/server/db/schema';
import { scoped } from '@/server/db/scope';
import { DEFAULT_CHART, DEFAULT_NUMBERING, DEFAULT_REMINDERS, DEFAULT_TERMS, FALLBACK_TIMEZONE } from '@/lib/defaults';
import { DOC_TYPES } from '@/lib/ledger-enums';

export type LedgerSettings = typeof settings.$inferSelect;

/** Writes the defaults for one org inside `tx`. Returns true when it made them now. */
export const writeDefaults = scoped(async function writeDefaults(tx: Executor, orgId: string, timezone: string = FALLBACK_TIMEZONE): Promise<boolean> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`ledger:setup:${orgId}`}))`);
  const made = await tx.insert(settings).values({ orgId, timezone }).onConflictDoNothing().returning({ orgId: settings.orgId });
  await tx
    .insert(accounts)
    .values(
      DEFAULT_CHART.map((account) => ({
        orgId,
        number: account.number,
        name: account.name,
        type: account.type,
        subtype: account.subtype,
        systemKey: account.systemKey ?? null,
        isContra: account.isContra ?? false,
        pulseCostCategory: account.pulseCostCategory ?? null,
        description: account.description ?? null,
      })),
    )
    .onConflictDoNothing();
  const existingTerms = await tx.select({ id: terms.id }).from(terms).where(eq(terms.orgId, orgId)).limit(1);
  if (existingTerms.length === 0) {
    await tx.insert(terms).values(
      DEFAULT_TERMS.map((term) => ({ orgId, name: term.name, kind: term.kind, days: term.days ?? null, dayOfMonth: term.dayOfMonth ?? null, isDefault: term.isDefault ?? false })),
    );
  }
  await tx
    .insert(numberSequences)
    .values(DOC_TYPES.map((docType) => ({ orgId, docType, prefix: DEFAULT_NUMBERING[docType].prefix, nextValue: BigInt(DEFAULT_NUMBERING[docType].next) })))
    .onConflictDoNothing();
  await tx
    .insert(reminderRules)
    .values(DEFAULT_REMINDERS.map((rule) => ({ orgId, offsetDays: rule.offsetDays, repeatEveryDays: rule.repeatEveryDays ?? null, maxCount: rule.maxCount ?? null, subject: rule.subject, body: rule.body })))
    .onConflictDoNothing();
  // The default terms on the settings row, once.
  await tx.execute(
    sql`update ledger.settings s set default_terms_id = t.id
          from ledger.terms t
         where s.org_id = ${orgId}::uuid and s.default_terms_id is null
           and t.org_id = s.org_id and t.is_default and t.active`,
  );
  return made.length > 0;
}, 1);

/** The org's Ledger settings, making every default on the first read. */
export const ensureLedgerSetup = scoped(async function ensureLedgerSetup(orgId: string): Promise<LedgerSettings> {
  const [found] = await db.select().from(settings).where(eq(settings.orgId, orgId));
  if (found) return found;
  await db.transaction(async (tx) => {
    await writeDefaults(tx, orgId);
  });
  const [made] = await db.select().from(settings).where(eq(settings.orgId, orgId));
  return made!;
});
