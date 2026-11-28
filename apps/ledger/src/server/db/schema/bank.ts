/** 5.6 Bank: accounts, statement imports, lines, matches, rules, transfers, reconciliations. */
import { boolean, date, integer, text, uuid } from 'drizzle-orm/pg-core';
import { base, cents, ledgerSchema, posting, tstz } from './_shared';

export const bankAccounts = ledgerSchema.table('bank_accounts', {
  ...base(),
  accountId: uuid('account_id').notNull(),
  name: text('name').notNull(),
  kind: text('kind').$type<'bank' | 'card'>().notNull().default('bank'),
  last4: text('last4'),
  feed: text('feed').$type<'statement_import' | 'provider'>().notNull().default('statement_import'),
  provider: text('provider'),
  providerRef: text('provider_ref'),
  currency: text('currency').notNull().default('USD'),
  openingBalanceCents: cents('opening_balance_cents').notNull().default(BigInt(0)),
  openingDate: date('opening_date'),
  archivedAt: tstz('archived_at'),
});

export const bankImports = ledgerSchema.table('bank_imports', {
  ...base(),
  bankAccountId: uuid('bank_account_id').notNull(),
  fileName: text('file_name'),
  fileHash: text('file_hash'),
  format: text('format').$type<'csv' | 'ofx'>().notNull(),
  lineCount: integer('line_count').notNull().default(0),
  newCount: integer('new_count').notNull().default(0),
  duplicateCount: integer('duplicate_count').notNull().default(0),
  statementEndDate: date('statement_end_date'),
  statementEndBalanceCents: cents('statement_end_balance_cents'),
  isSample: boolean('is_sample').notNull().default(false),
  createdBy: uuid('created_by'),
});

export const bankLines = ledgerSchema.table('bank_lines', {
  ...base(),
  bankAccountId: uuid('bank_account_id').notNull(),
  importId: uuid('import_id'),
  postedOn: date('posted_on').notNull(),
  amountCents: cents('amount_cents').notNull(),
  description: text('description').notNull().default(''),
  checkNumber: text('check_number'),
  fitid: text('fitid'),
  dedupeKey: text('dedupe_key').notNull(),
  status: text('status').$type<'unmatched' | 'matched' | 'not_ours'>().notNull().default('unmatched'),
  note: text('note'),
});

export const bankMatches = ledgerSchema.table('bank_matches', {
  ...base(),
  bankLineId: uuid('bank_line_id').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  amountCents: cents('amount_cents').notNull(),
  confirmedBy: uuid('confirmed_by'),
  confirmedAt: tstz('confirmed_at').notNull().defaultNow(),
  removedAt: tstz('removed_at'),
  removedBy: uuid('removed_by'),
});

export const bankRules = ledgerSchema.table('bank_rules', {
  ...base(),
  bankAccountId: uuid('bank_account_id'),
  contains: text('contains').notNull(),
  accountId: uuid('account_id'),
  vendorId: uuid('vendor_id'),
  memo: text('memo'),
  position: integer('position').notNull().default(0),
  active: boolean('active').notNull().default(true),
});

export const transfers = ledgerSchema.table('transfers', {
  ...base(),
  fromAccountId: uuid('from_account_id').notNull(),
  toAccountId: uuid('to_account_id').notNull(),
  transferredOn: date('transferred_on').notNull(),
  amountCents: cents('amount_cents').notNull(),
  memo: text('memo'),
  ...posting(),
  isSample: boolean('is_sample').notNull().default(false),
  createdBy: uuid('created_by'),
});

export const reconciliations = ledgerSchema.table('reconciliations', {
  ...base(),
  bankAccountId: uuid('bank_account_id').notNull(),
  statementEndDate: date('statement_end_date').notNull(),
  statementEndBalanceCents: cents('statement_end_balance_cents').notNull(),
  clearedCents: cents('cleared_cents').notNull().default(BigInt(0)),
  status: text('status').$type<'in_progress' | 'finished'>().notNull().default('in_progress'),
  finishedBy: uuid('finished_by'),
  finishedAt: tstz('finished_at'),
  matchedLineIds: uuid('matched_line_ids').array().notNull().default([]),
});
