/**
 * THE one writer of journal rows (docs/ledger/SPEC.md 4.3, 4.4). No other file inserts into
 * `ledger.journal_entries` or `ledger.journal_lines` (src/server/domain/posting-writer.test.ts
 * fails if one does). Each posting:
 *   1. checks the draft balances (`posting-rules.ts`),
 *   2. takes `pg_advisory_xact_lock(hashtext('ledger:' || org || ':' || type || ':' || id))`, so
 *      two posts of one document never race,
 *   3. names every account by id (system keys resolved in the org's chart),
 *   4. gives the entry the next `posting_seq` for its document and the next JE number,
 *   5. inserts the entry and its lines; the database checks the balance again at commit, refuses a
 *      closed month (KL003) and keeps `account_month_totals`.
 * It must run inside the caller's write transaction, next to the document change and its activity row.
 */
import 'server-only';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { accounts, journalEntries, journalLines } from '@/server/db/schema';
import type { Transaction } from '@/server/db';
import { scoped } from '@/server/db/scope';
import { DomainError } from '@/server/errors';
import type { SystemKey } from '@/lib/ledger-enums';
import { actorUserId, type DomainContext } from './_shared';
import { nextNumber } from './numbering';
import { assertBalanced, closedMonthMessage, PostingError, reversalOf, type AccountRef, type EntryDraft, type PostingLine } from './posting-rules';

export * from './posting-rules';

export interface PostedEntry {
  readonly entryId: string;
  readonly number: string;
  readonly postingSeq: number;
}

export interface PostOptions {
  readonly activityId?: string | null;
  readonly isSample?: boolean;
}

const firstOfMonth = (date: string): string => `${date.slice(0, 7)}-01`;

async function resolveAccounts(tx: Transaction, orgId: string, lines: readonly PostingLine[]): Promise<Map<string, string>> {
  const keys = [...new Set(lines.flatMap((line) => ('key' in line.account ? [line.account.key] : [])))];
  const ids = [...new Set(lines.flatMap((line) => ('id' in line.account ? [line.account.id] : [])))];
  const out = new Map<string, string>();
  if (keys.length > 0) {
    const rows = await tx.select({ id: accounts.id, key: accounts.systemKey }).from(accounts).where(and(eq(accounts.orgId, orgId), inArray(accounts.systemKey, keys as SystemKey[])));
    for (const row of rows) if (row.key) out.set(`k:${row.key}`, row.id);
    const missing = keys.filter((key) => !out.has(`k:${key}`));
    if (missing.length > 0) throw new DomainError('CONFLICT', `The chart of accounts is missing a system account (${missing.join(', ')}). Open Settings, Chart of accounts.`);
  }
  if (ids.length > 0) {
    const rows = await tx.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.orgId, orgId), inArray(accounts.id, ids)));
    for (const row of rows) out.set(`i:${row.id}`, row.id);
    if (rows.length !== ids.length) throw new DomainError('VALIDATION', 'An account on this entry is not in your chart of accounts.');
  }
  return out;
}

const refKey = (ref: AccountRef): string => ('key' in ref ? `k:${ref.key}` : `i:${ref.id}`);

type PgLike = { code?: string; message?: string; cause?: unknown } | null;

/**
 * A database refusal in plain words: the closed month sentence, an unbalanced entry. Drizzle wraps
 * driver errors, so the code is read from the error or its cause. Write transactions pass their
 * failure through this too, because the balance check runs at COMMIT.
 */
export function asDomainError(error: unknown): unknown {
  const raw = error as PgLike;
  const found = (raw?.code ? raw : (raw?.cause as PgLike)) ?? raw;
  if (found?.code === 'KL003') {
    const month = /month_closed:(\d{4}-\d{2})/.exec(found.message ?? '')?.[1];
    return new DomainError('CONFLICT', month ? closedMonthMessage(month) : 'That month is closed.');
  }
  if (found?.code === 'KL001') return new DomainError('VALIDATION', 'This entry does not balance, so nothing was saved.');
  if (error instanceof PostingError) return new DomainError('VALIDATION', error.message);
  return error;
}

/** Posts one entry inside the caller's transaction. Refuses anything that does not balance. */
export const postEntry = scoped(async function postEntry(tx: Transaction, ctx: DomainContext, entry: EntryDraft, options: PostOptions = {}): Promise<PostedEntry> {
  try {
    assertBalanced(entry);
    if (entry.sourceId) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`ledger:${ctx.orgId}:${entry.sourceType}:${entry.sourceId}`}))`);
    }
    const accountIds = await resolveAccounts(tx, ctx.orgId, entry.lines);
    let postingSeq = 0;
    if (entry.sourceId) {
      const [row] = await tx
        .select({ next: sql<number>`coalesce(max(${journalEntries.postingSeq}) + 1, 0)::int` })
        .from(journalEntries)
        .where(and(eq(journalEntries.orgId, ctx.orgId), eq(journalEntries.sourceType, entry.sourceType), eq(journalEntries.sourceId, entry.sourceId)));
      postingSeq = row?.next ?? 0;
    }
    const number = await nextNumber(tx, ctx, 'journal');
    const [inserted] = await tx
      .insert(journalEntries)
      .values({
        orgId: ctx.orgId,
        number,
        entryDate: entry.entryDate,
        periodMonth: firstOfMonth(entry.entryDate),
        sourceType: entry.sourceType,
        sourceId: entry.sourceId,
        postingSeq,
        reversesEntryId: entry.reversesEntryId ?? null,
        autoReverseOn: entry.autoReverseOn ?? null,
        memo: entry.memo ?? null,
        activityId: options.activityId ?? null,
        postedBy: actorUserId(ctx),
        isSample: options.isSample ?? false,
      })
      .returning({ id: journalEntries.id });
    const entryId = inserted!.id;
    await tx.insert(journalLines).values(
      entry.lines.map((line, index) => ({
        orgId: ctx.orgId,
        entryId,
        lineNo: index + 1,
        accountId: accountIds.get(refKey(line.account))!,
        debitCents: line.debit,
        creditCents: line.credit,
        customerId: line.customerId ?? null,
        vendorId: line.vendorId ?? null,
        invoiceId: line.invoiceId ?? null,
        billId: line.billId ?? null,
        pulseJobId: line.pulseJobId ?? null,
        taxRateId: line.taxRateId ?? null,
        memo: line.memo ?? null,
        // Copied from the entry by the database trigger; sent so the row type is complete.
        entryDate: entry.entryDate,
        periodMonth: firstOfMonth(entry.entryDate),
      })),
    );
    return { entryId, number, postingSeq };
  } catch (error) {
    throw asDomainError(error);
  }
}, 1);

/** Posts the reversing entry of `entryId` (same source, sides swapped), dated `date` or the original date. */
export const reverseEntry = scoped(async function reverseEntry(tx: Transaction, ctx: DomainContext, entryId: string, options: PostOptions & { readonly date?: string } = {}): Promise<PostedEntry> {
  const [original] = await tx.select().from(journalEntries).where(and(eq(journalEntries.orgId, ctx.orgId), eq(journalEntries.id, entryId)));
  if (!original) throw new DomainError('NOT_FOUND', "That entry doesn't exist or you no longer have access to it.");
  const lines = await tx.select().from(journalLines).where(and(eq(journalLines.orgId, ctx.orgId), eq(journalLines.entryId, entryId))).orderBy(journalLines.lineNo);
  const draft = reversalOf(
    {
      id: original.id,
      sourceType: original.sourceType,
      sourceId: original.sourceId,
      entryDate: original.entryDate,
      lines: lines.map((line) => ({
        account: { id: line.accountId },
        debit: line.debitCents,
        credit: line.creditCents,
        customerId: line.customerId,
        vendorId: line.vendorId,
        invoiceId: line.invoiceId,
        billId: line.billId,
        pulseJobId: line.pulseJobId,
        taxRateId: line.taxRateId,
        memo: line.memo,
      })),
    },
    options.date,
  );
  return postEntry(tx, ctx, draft, options);
}, 1);
