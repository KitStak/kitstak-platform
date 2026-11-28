/**
 * Removes every `ledger` row of one org (seed wipe, and later "Remove all data", `data:purge`).
 * Runs inside the caller's transaction under `SET LOCAL ledger.allow_purge = 'on'`, the one way
 * past the append only journal (docs/ledger/SPEC.md 4.3). Children go first, so the composite
 * foreign keys hold after every statement.
 */
import 'server-only';
import { sql } from 'drizzle-orm';
import type { Transaction } from '@/server/db';
import { scoped } from '@/server/db/scope';

/** Delete order: every table before the tables it points at. */
export const PURGE_ORDER = [
  'journal_lines',
  'account_month_totals',
  'bank_matches',
  'payment_applications',
  'bill_payment_applications',
  'write_offs',
  'disputes',
  'reminder_sends',
  'public_links',
  'invoice_sources',
  'invoice_lines',
  'recurring_invoice_lines',
  'bill_lines',
  'expense_lines',
  'emails',
  'promises',
  'payments',
  'invoices',
  'recurring_invoices',
  'bills',
  'bill_payments',
  'expenses',
  'reimbursement_payments',
  'deposits',
  'transfers',
  'reconciliations',
  'bank_rules',
  'bank_lines',
  'bank_imports',
  'bank_accounts',
  'accruals',
  'journal_entries',
  'close_tasks',
  'close_task_templates',
  'periods',
  'settings',
  'customer_profiles',
  'vendor_profiles',
  'program_billing',
  'source_mappings',
  'items',
  'tax_rates',
  'terms',
  'number_sequences',
  'reminder_rules',
  'attachments',
  'activity',
  'notifications',
  'user_prefs',
  'import_rows',
  'import_batches',
  'import_presets',
  'bridge_events',
  'sync_queue',
  'sync_objects',
  'sync_runs',
  'remote_changes',
  'sync_connections',
  'member_roles',
  'accounts',
] as const;

export const purgeLedgerRows = scoped(async function purgeLedgerRows(tx: Transaction, orgId: string): Promise<number> {
  await tx.execute(sql`select set_config('ledger.allow_purge', 'on', true)`);
  let removed = 0;
  for (const table of PURGE_ORDER) {
    const result = await tx.execute(sql`delete from ${sql.identifier('ledger')}.${sql.identifier(table)} where org_id = ${orgId}::uuid`);
    removed += result.rowCount ?? 0;
  }
  await tx.execute(sql`select set_config('ledger.allow_purge', 'off', true)`);
  return removed;
}, 1);
