'use server';
/** Settings actions for items, tax rates, terms, the chart of accounts and source mappings (SPEC 5.2). */
import { z } from 'zod';
import { createAccount, setAccountArchived, updateAccount } from '@/server/domain/chart';
import { createItem, setItemArchived, updateItem } from '@/server/domain/items';
import { MAPPING_SOURCES, setMapping } from '@/server/domain/mappings';
import { createTaxRate, setTaxRateArchived, updateTaxRate } from '@/server/domain/tax-rates';
import { createTerms, setDefaultTerms, setTermsArchived, updateTerms } from '@/server/domain/terms';
import { priceForDb, readPrice, readRatePct } from '@/server/csv/cells';
import { ACCOUNT_SUBTYPES, ACCOUNT_TYPES, PULSE_COST_CATEGORIES, TERMS_KINDS } from '@/lib/ledger-enums';
import { DomainError } from '@/server/errors';
import { runAction, type ActionResult } from './_action';

const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => text(max).nullable().optional().transform((value) => (value ? value : null));
const optionalId = z.uuid().nullable().optional().transform((value) => value ?? null);
const versioned = { id: z.uuid(), version: z.number().int().min(0) };
const archiveSchema = z.object({ id: z.uuid(), archived: z.boolean() });

/* ------------------------------------------------------------------------------- items */

const itemSchema = z.object({
  code: text(40).min(1, 'Give the item a code.'),
  name: text(200).min(1, 'Give the item a name.'),
  description: optionalText(2000),
  unitLabel: optionalText(40),
  /** Typed price, like 18.50. Blank for none. */
  defaultPrice: optionalText(20),
  accountId: z.uuid('Pick the revenue account.'),
  taxRateId: optionalId,
});

function itemInput(data: z.output<typeof itemSchema>) {
  let price: string | null = null;
  if (data.defaultPrice) {
    const read = readPrice(data.defaultPrice);
    if (!read.ok) throw new DomainError('VALIDATION', read.message, { defaultPrice: read.message });
    price = priceForDb(read.value);
  }
  return { ...data, defaultPrice: price };
}

export async function createItemAction(input: z.input<typeof itemSchema>): Promise<ActionResult<{ id: string }>> {
  return runAction(itemSchema, input, async (data, ctx) => ({ id: await createItem(ctx, itemInput(data)) }));
}

const updateItemSchema = itemSchema.extend(versioned);
export async function updateItemAction(input: z.input<typeof updateItemSchema>): Promise<ActionResult<void>> {
  return runAction(updateItemSchema, input, (data, ctx) => {
    const { id, version, ...rest } = data;
    return updateItem(ctx, id, itemInput(rest), version);
  });
}

export async function setItemArchivedAction(input: z.input<typeof archiveSchema>): Promise<ActionResult<void>> {
  return runAction(archiveSchema, input, (data, ctx) => setItemArchived(ctx, data.id, data.archived));
}

/* --------------------------------------------------------------------------- tax rates */

const taxSchema = z.object({
  name: text(120).min(1, 'Give the rate a name.'),
  /** Typed percent, like 8.25. */
  ratePct: text(12).min(1, 'Give the rate, like 8.25.'),
  accountId: optionalId,
  agency: optionalText(200),
});

function taxInput(data: z.output<typeof taxSchema>) {
  const read = readRatePct(data.ratePct);
  if (!read.ok) throw new DomainError('VALIDATION', read.message, { ratePct: read.message });
  return { name: data.name, rateMillionths: read.value, accountId: data.accountId, agency: data.agency };
}

export async function createTaxRateAction(input: z.input<typeof taxSchema>): Promise<ActionResult<{ id: string }>> {
  return runAction(taxSchema, input, async (data, ctx) => ({ id: await createTaxRate(ctx, taxInput(data)) }));
}

const updateTaxSchema = taxSchema.extend(versioned);
export async function updateTaxRateAction(input: z.input<typeof updateTaxSchema>): Promise<ActionResult<void>> {
  return runAction(updateTaxSchema, input, (data, ctx) => {
    const { id, version, ...rest } = data;
    return updateTaxRate(ctx, id, taxInput(rest), version);
  });
}

export async function setTaxRateArchivedAction(input: z.input<typeof archiveSchema>): Promise<ActionResult<void>> {
  return runAction(archiveSchema, input, (data, ctx) => setTaxRateArchived(ctx, data.id, data.archived));
}

/* ------------------------------------------------------------------------------- terms */

const wholeOrNull = z
  .union([z.number().int(), z.string().trim()])
  .nullable()
  .optional()
  .transform((value, issue) => {
    if (value === null || value === undefined || value === '') return null;
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(n)) {
      issue.addIssue({ code: 'custom', message: 'Give a whole number.' });
      return z.NEVER;
    }
    return n;
  });

const termsSchema = z.object({ name: text(80).min(1, 'Give the terms a name.'), kind: z.enum(TERMS_KINDS), days: wholeOrNull, dayOfMonth: wholeOrNull });

export async function createTermsAction(input: z.input<typeof termsSchema>): Promise<ActionResult<{ id: string }>> {
  return runAction(termsSchema, input, async (data, ctx) => ({ id: await createTerms(ctx, data) }));
}

const updateTermsSchema = termsSchema.extend(versioned);
export async function updateTermsAction(input: z.input<typeof updateTermsSchema>): Promise<ActionResult<void>> {
  return runAction(updateTermsSchema, input, (data, ctx) => {
    const { id, version, ...rest } = data;
    return updateTerms(ctx, id, rest, version);
  });
}

export async function setDefaultTermsAction(input: { readonly id: string }): Promise<ActionResult<void>> {
  return runAction(z.object({ id: z.uuid() }), input, (data, ctx) => setDefaultTerms(ctx, data.id));
}

export async function setTermsArchivedAction(input: z.input<typeof archiveSchema>): Promise<ActionResult<void>> {
  return runAction(archiveSchema, input, (data, ctx) => setTermsArchived(ctx, data.id, data.archived));
}

/* ---------------------------------------------------------------------------- accounts */

const accountSchema = z.object({
  number: text(20).min(1, 'Give the account a number.'),
  name: text(200).min(1, 'Give the account a name.'),
  type: z.enum(ACCOUNT_TYPES),
  subtype: z.enum(ACCOUNT_SUBTYPES),
  parentId: optionalId,
  description: optionalText(2000),
  pulseCostCategory: z
    .enum(PULSE_COST_CATEGORIES)
    .nullable()
    .optional()
    .transform((value) => value ?? null),
});

export async function createAccountAction(input: z.input<typeof accountSchema>): Promise<ActionResult<{ id: string }>> {
  return runAction(accountSchema, input, async (data, ctx) => ({ id: await createAccount(ctx, data) }));
}

const updateAccountSchema = accountSchema.extend(versioned);
export async function updateAccountAction(input: z.input<typeof updateAccountSchema>): Promise<ActionResult<void>> {
  return runAction(updateAccountSchema, input, (data, ctx) => {
    const { id, version, ...rest } = data;
    return updateAccount(ctx, id, rest, version);
  });
}

export async function setAccountArchivedAction(input: z.input<typeof archiveSchema>): Promise<ActionResult<void>> {
  return runAction(archiveSchema, input, (data, ctx) => setAccountArchived(ctx, data.id, data.archived));
}

/* ---------------------------------------------------------------------------- mappings */

const mappingSchema = z.object({ source: z.enum(MAPPING_SOURCES), key: text(80).min(1), itemId: z.uuid().nullable() });

export async function setMappingAction(input: z.input<typeof mappingSchema>): Promise<ActionResult<void>> {
  return runAction(mappingSchema, input, (data, ctx) => setMapping(ctx, data.source, data.key, data.itemId));
}
