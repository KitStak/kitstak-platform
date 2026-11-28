/**
 * The books on the real database (docs/ledger/SPEC.md 4.3, 5, 14). Throwaway orgs; the org
 * cascade removes everything at the end. Skipped when no database answers or the ledger schema
 * or the guard role is not there.
 *
 * Proves:
 *   - the balanced trigger refuses an unbalanced entry and an entry with one line, at commit;
 *   - append only: a posted line or entry cannot be changed or removed (except under purge);
 *   - a closed month refuses a new entry, with the house sentence through postEntry;
 *   - one org cannot read or write another org's ledger rows (RLS as ledger_app, composite FKs,
 *     the customer org guard);
 *   - postEntry balances, numbers, sequences and keeps account_month_totals; reverseEntry nets to zero;
 *   - the defaults are made on first read, once.
 */
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/server/db';
import { accounts, accountMonthTotals, journalEntries, journalLines } from '@/server/db/schema';
import { DB_GUARD_ROLE, dbGuardRefusals, withOrg } from '@/server/db/scope';
import { dbGuardStatus } from '@/server/db/system';
import { ensureLedgerSetup } from '@/server/domain/setup';
import { invoiceSent, postEntry, reverseEntry } from '@/server/domain/posting';
import { ledgerAccessFor, claimLedger, canClaimLedger } from '@/server/domain/access';
import { isDomainError } from '@/server/errors';
import type { DomainContext } from '@/server/domain/_shared';
import { createTestOrg, databaseReady, TEST_DATABASE_URL, type TestOrg } from '@/test/db';

const ready = (await databaseReady()) && (await dbGuardStatus()).ready;

describe.skipIf(!ready)('the ledger books on the database', () => {
  let orgA: TestOrg;
  let orgB: TestOrg;
  let ownerA: DomainContext;
  let ownerB: DomainContext;
  let customerA: string;
  let customerB: string;
  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 3 });

  /** Runs `fn` in one transaction as the table owner and returns its error, if any (commit included). */
  async function ownerTx(fn: (client: pg.PoolClient) => Promise<void>): Promise<{ code?: string; message: string } | null> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await fn(client);
      await client.query('COMMIT');
      return null;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      return error as { code?: string; message: string };
    } finally {
      client.release();
    }
  }

  async function accountId(orgId: string, key: string): Promise<string> {
    const { rows } = await pool.query<{ id: string }>('select id from ledger.accounts where org_id = $1 and system_key = $2', [orgId, key]);
    return rows[0]!.id;
  }

  async function rawEntry(client: pg.PoolClient, orgId: string, lines: readonly [string, number, number][]): Promise<string> {
    const { rows } = await client.query<{ id: string }>(`insert into ledger.journal_entries (org_id, entry_date, period_month, source_type) values ($1, '2026-11-05', '2026-11-01', 'manual') returning id`, [orgId]);
    const entryId = rows[0]!.id;
    let lineNo = 0;
    for (const [account, debit, credit] of lines) {
      lineNo += 1;
      await client.query(`insert into ledger.journal_lines (org_id, entry_id, line_no, account_id, debit_cents, credit_cents, entry_date, period_month) values ($1, $2, $3, $4, $5, $6, '2026-11-05', '2026-11-01')`, [orgId, entryId, lineNo, account, debit, credit]);
    }
    return entryId;
  }

  beforeAll(async () => {
    vi.stubEnv('LEDGER_DB_GUARD', '1');
    orgA = await createTestOrg('ledger-books-a');
    orgB = await createTestOrg('ledger-books-b');
    ownerA = await orgA.member('owner', 'Books Owner A');
    ownerB = await orgB.member('owner', 'Books Owner B');
    customerA = randomUUID();
    customerB = randomUUID();
    await pool.query(`insert into core.customers (id, org_id, code, name) values ($1, $2, 'HRB', 'Harbor Roast'), ($3, $4, 'APX', 'Apex Threads')`, [customerA, orgA.orgId, customerB, orgB.orgId]);
    await ensureLedgerSetup(orgA.orgId);
    await ensureLedgerSetup(orgB.orgId);
  });

  afterAll(async () => {
    await orgA?.destroy();
    await orgB?.destroy();
    await pool.end();
  });

  it('makes the defaults on the first read, once', async () => {
    await ensureLedgerSetup(orgA.orgId);
    const { rows } = await pool.query<{ accounts: number; terms: number; seqs: number; def: string | null }>(
      `select (select count(*)::int from ledger.accounts where org_id = $1) as accounts,
              (select count(*)::int from ledger.terms where org_id = $1) as terms,
              (select count(*)::int from ledger.number_sequences where org_id = $1) as seqs,
              (select default_terms_id::text from ledger.settings where org_id = $1) as def`,
      [orgA.orgId],
    );
    expect(rows[0]).toMatchObject({ accounts: 46, terms: 6, seqs: 6 });
    expect(rows[0]!.def).not.toBeNull();
  });

  it('refuses an unbalanced entry at commit', async () => {
    const ar = await accountId(orgA.orgId, 'ar');
    const revenue = await accountId(orgA.orgId, 'default_revenue');
    const error = await ownerTx(async (client) => {
      await rawEntry(client, orgA.orgId, [[ar, 1000, 0], [revenue, 0, 999]]);
    });
    expect(error?.code).toBe('KL001');
  });

  it('refuses an entry with one line at commit', async () => {
    const ar = await accountId(orgA.orgId, 'ar');
    const error = await ownerTx(async (client) => {
      await rawEntry(client, orgA.orgId, [[ar, 1000, 0]]);
    });
    expect(error?.code).toBe('KL001');
  });

  it('keeps a balanced entry, and then refuses to change or remove its lines', async () => {
    const ar = await accountId(orgA.orgId, 'ar');
    const revenue = await accountId(orgA.orgId, 'default_revenue');
    let entryId = '';
    expect(await ownerTx(async (client) => {
      entryId = await rawEntry(client, orgA.orgId, [[ar, 1000, 0], [revenue, 0, 1000]]);
    })).toBeNull();
    const update = await ownerTx(async (client) => {
      await client.query('update ledger.journal_lines set debit_cents = 2000 where entry_id = $1 and line_no = 1', [entryId]);
    });
    expect(update?.code).toBe('KL002');
    const remove = await ownerTx(async (client) => {
      await client.query('delete from ledger.journal_lines where entry_id = $1', [entryId]);
    });
    expect(remove?.code).toBe('KL002');
    const entryEdit = await ownerTx(async (client) => {
      await client.query(`update ledger.journal_entries set memo = 'changed' where id = $1`, [entryId]);
    });
    expect(entryEdit?.code).toBe('KL002');
    // The purge switch is the one way past it.
    const purge = await ownerTx(async (client) => {
      await client.query(`select set_config('ledger.allow_purge', 'on', true)`);
      await client.query('delete from ledger.journal_lines where entry_id = $1', [entryId]);
      await client.query('delete from ledger.journal_entries where id = $1', [entryId]);
    });
    expect(purge).toBeNull();
  });

  it('lets a person be deleted after they posted and acted, blanking only their name', async () => {
    const ar = await accountId(orgA.orgId, 'ar');
    const revenue = await accountId(orgA.orgId, 'default_revenue');
    const leaver = await orgA.member('member', 'Books Leaver');
    let entryId = '';
    expect(await ownerTx(async (client) => {
      entryId = await rawEntry(client, orgA.orgId, [[ar, 500, 0], [revenue, 0, 500]]);
    })).toBeNull();
    // Posting sets posted_by at insert; the purge switch is the one way to stamp it afterwards, as here.
    expect(await ownerTx(async (client) => {
      await client.query(`select set_config('ledger.allow_purge', 'on', true)`);
      await client.query('update ledger.journal_entries set posted_by = $2 where id = $1', [entryId, leaver.userId]);
      await client.query(`insert into ledger.activity (org_id, actor_id, verb, entity_type) values ($1, $2, 'invoice.sent', 'invoice')`, [orgA.orgId, leaver.userId]);
    })).toBeNull();

    // Anything but blanking the person is still refused.
    const swap = await ownerTx(async (client) => {
      await client.query('update ledger.journal_entries set posted_by = $2 where id = $1', [entryId, ownerA.userId]);
    });
    expect(swap?.code).toBe('KL002');
    const blankAndEdit = await ownerTx(async (client) => {
      await client.query(`update ledger.journal_entries set posted_by = null, memo = 'changed' where id = $1`, [entryId]);
    });
    expect(blankAndEdit?.code).toBe('KL002');

    // Deleting the person blanks their name on the entry and the activity row.
    const remove = await ownerTx(async (client) => {
      await client.query('delete from core.member where user_id = $1', [leaver.userId]);
      await client.query('delete from core."user" where id = $1', [leaver.userId]);
    });
    expect(remove).toBeNull();
    const { rows: entry } = await pool.query<{ posted_by: string | null }>('select posted_by from ledger.journal_entries where id = $1', [entryId]);
    expect(entry[0]?.posted_by).toBeNull();
    const { rows: acted } = await pool.query<{ n: string }>('select count(*) as n from ledger.activity where org_id = $1 and actor_id is null and verb = $2', [orgA.orgId, 'invoice.sent']);
    expect(Number(acted[0]?.n)).toBeGreaterThan(0);

    // Leave the org's totals as they were for the tests after this one.
    expect(await ownerTx(async (client) => {
      await client.query(`select set_config('ledger.allow_purge', 'on', true)`);
      await client.query('delete from ledger.journal_lines where entry_id = $1', [entryId]);
      await client.query('delete from ledger.journal_entries where id = $1', [entryId]);
    })).toBeNull();
  });

  it('refuses a new entry in a closed month', async () => {
    const ar = await accountId(orgA.orgId, 'ar');
    const revenue = await accountId(orgA.orgId, 'default_revenue');
    await pool.query(`insert into ledger.periods (org_id, period_month, status, closed_at) values ($1, '2026-09-01', 'closed', now())`, [orgA.orgId]);
    const error = await ownerTx(async (client) => {
      const { rows } = await client.query<{ id: string }>(`insert into ledger.journal_entries (org_id, entry_date, period_month, source_type) values ($1, '2026-09-15', '2026-09-01', 'manual') returning id`, [orgA.orgId]);
      await client.query(`insert into ledger.journal_lines (org_id, entry_id, line_no, account_id, debit_cents, entry_date, period_month) values ($1, $2, 1, $3, 5, '2026-09-15', '2026-09-01')`, [orgA.orgId, rows[0]!.id, ar]);
      await client.query(`insert into ledger.journal_lines (org_id, entry_id, line_no, account_id, credit_cents, entry_date, period_month) values ($1, $2, 2, $3, 5, '2026-09-15', '2026-09-01')`, [orgA.orgId, rows[0]!.id, revenue]);
    });
    expect(error?.code).toBe('KL003');
    expect(error?.message).toContain('month_closed:2026-09');
    // Through the one writer, the house sentence.
    const septemberInvoice = randomUUID();
    await pool.query(`insert into ledger.invoices (id, org_id, customer_id, issue_date) values ($1, $2, $3, '2026-09-20')`, [septemberInvoice, orgA.orgId, customerA]);
    const refused = await withOrg(ownerA.orgId, () =>
      db.transaction((tx) => postEntry(tx, ownerA, invoiceSent({ id: septemberInvoice, customerId: customerA, date: '2026-09-20', totalCents: BigInt(100), lines: [{ accountId: revenue, amountCents: BigInt(100), taxCents: BigInt(0) }] }))),
    ).catch((caught: unknown) => caught);
    expect(isDomainError(refused) && refused.message).toBe('September 2026 is closed. Date it in October, or ask the owner to reopen September.');
  });

  it('posts through postEntry as ledger_app: numbered, sequenced, totals kept, reversal nets to zero', async () => {
    const revenue = await accountId(orgA.orgId, 'default_revenue');
    const invoiceId = randomUUID();
    // Journal lines point at a real invoice (composite FK): a draft row stands in for it here.
    await pool.query(`insert into ledger.invoices (id, org_id, customer_id, issue_date) values ($1, $2, $3, '2026-11-10')`, [invoiceId, orgA.orgId, customerA]);
    const draft = invoiceSent({ id: invoiceId, customerId: customerA, date: '2026-11-10', totalCents: BigInt(1598566), lines: [{ accountId: revenue, amountCents: BigInt(1597700), taxCents: BigInt(866), taxRateId: null }] });
    const posted = await withOrg(ownerA.orgId, () =>
      db.transaction(async (tx) => {
        const role = await tx.execute<{ role: string }>(sql`select current_user::text as role`);
        expect(role.rows[0]!.role).toBe(DB_GUARD_ROLE);
        return postEntry(tx, ownerA, draft);
      }),
    );
    expect(posted.number).toMatch(/^JE-\d+$/);
    expect(posted.postingSeq).toBe(0);
    const reversed = await withOrg(ownerA.orgId, () => db.transaction((tx) => reverseEntry(tx, ownerA, posted.entryId)));
    expect(reversed.postingSeq).toBe(1);
    const totals = await withOrg(ownerA.orgId, () =>
      db
        .select({ debit: accountMonthTotals.debitCents, credit: accountMonthTotals.creditCents })
        .from(accountMonthTotals)
        .innerJoin(accounts, eq(accounts.id, accountMonthTotals.accountId))
        .where(and(eq(accountMonthTotals.orgId, ownerA.orgId), eq(accounts.systemKey, 'ar'), eq(accountMonthTotals.periodMonth, '2026-11-01'))),
    );
    expect(totals[0]!.debit - totals[0]!.credit).toBe(BigInt(0));
    expect(totals[0]!.debit).toBeGreaterThanOrEqual(BigInt(1598566));
    // account_month_totals equals the sum of journal_lines for the org.
    const { rows } = await pool.query<{ ok: boolean }>(
      `select not exists (
         select 1 from ledger.account_month_totals t
          where t.org_id = $1 and (
            t.debit_cents <> (select coalesce(sum(l.debit_cents), 0) from ledger.journal_lines l
                               where l.org_id = t.org_id and l.account_id = t.account_id and l.period_month = t.period_month)
            or t.credit_cents <> (select coalesce(sum(l.credit_cents), 0) from ledger.journal_lines l
                               where l.org_id = t.org_id and l.account_id = t.account_id and l.period_month = t.period_month))) as ok`,
      [orgA.orgId],
    );
    expect(rows[0]!.ok).toBe(true);
    const lines = await withOrg(ownerA.orgId, () => db.select().from(journalLines).where(eq(journalLines.entryId, posted.entryId)));
    expect(lines.every((line) => line.periodMonth === '2026-11-01')).toBe(true);
  });

  it('keeps one org out of another org ledger rows (RLS as ledger_app)', async () => {
    const entriesOfB = await pool.query<{ n: number }>('select count(*)::int as n from ledger.accounts where org_id = $1', [orgB.orgId]);
    expect(entriesOfB.rows[0]!.n).toBeGreaterThan(0);
    // As org A, ask for org B's rows by id: the database answers nothing.
    const seen = await withOrg(ownerA.orgId, () => db.select({ id: accounts.id }).from(accounts).where(eq(accounts.orgId, orgB.orgId)));
    expect(seen).toEqual([]);
    const seenEntries = await withOrg(ownerA.orgId, () => db.select({ id: journalEntries.id }).from(journalEntries).where(eq(journalEntries.orgId, orgB.orgId)));
    expect(seenEntries).toEqual([]);
    // Writing a row for org B from org A's scope is refused by the policy.
    const write = await withOrg(ownerA.orgId, () =>
      db.insert(accounts).values({ orgId: orgB.orgId, number: '9999', name: 'Sneaky', type: 'asset', subtype: 'other' }).catch((error: unknown) => error),
    );
    expect(String((write as { cause?: { message?: string } })?.cause?.message ?? write)).toMatch(/row-level security/);
    // The refusal above is on purpose; the suite fails on any other one.
    dbGuardRefusals(true);
  });

  it('refuses a journal line pointing at another org account or customer', async () => {
    const accountOfB = await accountId(orgB.orgId, 'ar');
    const revenueA = await accountId(orgA.orgId, 'default_revenue');
    const arA = await accountId(orgA.orgId, 'ar');
    const crossAccount = await ownerTx(async (client) => {
      await rawEntry(client, orgA.orgId, [[accountOfB, 10, 0], [revenueA, 0, 10]]);
    });
    expect(crossAccount?.code).toBe('23503');
    const crossCustomer = await ownerTx(async (client) => {
      await client.query(`insert into ledger.invoices (org_id, customer_id, issue_date) values ($1, $2, '2026-11-01')`, [orgA.orgId, customerB]);
    });
    expect(crossCustomer?.code).toBe('KL004');
    expect(arA).not.toBe(accountOfB);
  });

  it('resolves roles from the org, and refuses the claim while an owner exists', async () => {
    expect((await ledgerAccessFor(ownerB)).role).toBe('owner');
    const admin = await orgB.member('admin', 'Books Admin B');
    expect(await canClaimLedger(admin)).toBe(false);
    const floor = await orgB.member('member', 'Floor Person B');
    expect((await ledgerAccessFor(floor)).role).toBe('none');
  });

  it('lets the first admin claim Ledger when nobody is owner', async () => {
    const orgC = await createTestOrg('ledger-claim');
    try {
      const admin = await orgC.member('admin', 'Claim Admin');
      await ensureLedgerSetup(orgC.orgId);
      expect(await canClaimLedger(admin)).toBe(true);
      await claimLedger(admin);
      expect((await ledgerAccessFor(admin)).role).toBe('owner');
      expect(await canClaimLedger(admin)).toBe(false);
    } finally {
      await orgC.destroy();
    }
  });
});
