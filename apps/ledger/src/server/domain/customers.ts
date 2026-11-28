/**
 * Customers (docs/ledger/SPEC.md 5.2, 13 Phase 1). The customer itself is the shared
 * `core.customers` row (code and name, used by WMS, CRM and Pulse); Ledger keeps its money
 * settings beside it in `ledger.customer_profiles`: invoice emails and contact, address, terms,
 * tax, reminders. Ledger may add a customer (code and name) so a shop can run Ledger alone, and
 * never deletes one. Seeing customers needs `money:read`; adding and changing them needs
 * `invoice:write`.
 */
import 'server-only';
import { sql } from 'drizzle-orm';
import { db, type Executor, type Transaction } from '@/server/db';
import { scoped } from '@/server/db/scope';
import { DomainError, conflict, notFound } from '@/server/errors';
import { requireRight } from './access';
import { logActivity } from './activity';
import { actorUserId, isUuid, textOrNull, type DomainContext } from './_shared';

export interface PostalAddress {
  readonly line1?: string;
  readonly city?: string;
  readonly region?: string;
  readonly postalCode?: string;
  readonly country?: string;
}

export interface CustomerInput {
  readonly code: string;
  readonly name: string;
  readonly phone: string | null;
  readonly billingContactName: string | null;
  readonly billingEmails: readonly string[];
  readonly billingAddress: PostalAddress | null;
  readonly termsId: string | null;
  readonly defaultTaxRateId: string | null;
  readonly taxExempt: boolean;
  readonly exemptionNote: string | null;
  readonly remindersEnabled: boolean;
  readonly notes: string | null;
}

export interface CustomerRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly status: string;
  readonly billingEmails: readonly string[];
  readonly termsName: string | null;
  readonly taxExempt: boolean;
  readonly remindersEnabled: boolean;
  readonly hasProfile: boolean;
}

export interface CustomerDetail extends CustomerRow {
  readonly contactName: string | null;
  readonly contactEmail: string | null;
  readonly phone: string | null;
  readonly billingContactName: string | null;
  readonly billingAddress: PostalAddress | null;
  readonly termsId: string | null;
  readonly defaultTaxRateId: string | null;
  readonly taxRateName: string | null;
  readonly exemptionNote: string | null;
  readonly notes: string | null;
  /** The profile version (0 before Ledger saved anything for this customer). */
  readonly version: number;
}

type CustomerDbRow = {
  id: string;
  code: string;
  name: string;
  status: string;
  contact_name: string | null;
  contact_email: string | null;
  phone: string | null;
  billing_emails: string[] | null;
  billing_contact_name: string | null;
  billing_address: PostalAddress | null;
  terms_id: string | null;
  terms_name: string | null;
  default_tax_rate_id: string | null;
  tax_rate_name: string | null;
  tax_exempt: boolean | null;
  exemption_note: string | null;
  reminders_enabled: boolean | null;
  notes: string | null;
  version: number | null;
}

const SELECT = sql`select c.id, c.code, c.name, c.status, c.contact_name, c.contact_email, c.phone,
       p.billing_emails, p.billing_contact_name, p.billing_address, p.terms_id, t.name as terms_name,
       p.default_tax_rate_id, r.name as tax_rate_name, p.tax_exempt, p.exemption_note, p.reminders_enabled, p.notes, p.version
  from core.customers c
  left join ledger.customer_profiles p on p.org_id = c.org_id and p.customer_id = c.id
  left join ledger.terms t on t.org_id = p.org_id and t.id = p.terms_id
  left join ledger.tax_rates r on r.org_id = p.org_id and r.id = p.default_tax_rate_id`;

function toDetail(row: CustomerDbRow): CustomerDetail {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    status: row.status,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    phone: row.phone,
    billingEmails: row.billing_emails ?? [],
    billingContactName: row.billing_contact_name,
    billingAddress: row.billing_address,
    termsId: row.terms_id,
    termsName: row.terms_name,
    defaultTaxRateId: row.default_tax_rate_id,
    taxRateName: row.tax_rate_name,
    taxExempt: row.tax_exempt ?? false,
    exemptionNote: row.exemption_note,
    remindersEnabled: row.reminders_enabled ?? true,
    notes: row.notes,
    hasProfile: row.version !== null,
    version: row.version ?? 0,
  };
}

/** Every customer of the workspace with Ledger's settings (inactive ones last). */
export const listCustomers = scoped(async function listCustomers(ctx: DomainContext): Promise<readonly CustomerDetail[]> {
  await requireRight(ctx, 'money:read');
  const result = await db.execute<CustomerDbRow>(sql`${SELECT} where c.org_id = ${ctx.orgId}::uuid and c.deleted_at is null order by (c.status <> 'Active'), lower(c.name)`);
  return result.rows.map(toDetail);
});

export const getCustomer = scoped(async function getCustomer(ctx: DomainContext, id: string): Promise<CustomerDetail> {
  await requireRight(ctx, 'money:read');
  if (!isUuid(id)) throw notFound('That customer');
  const result = await db.execute<CustomerDbRow>(sql`${SELECT} where c.org_id = ${ctx.orgId}::uuid and c.id = ${id}::uuid and c.deleted_at is null`);
  const row = result.rows[0];
  if (!row) throw notFound('That customer');
  return toDetail(row);
});

function normalize(input: CustomerInput): CustomerInput {
  const code = input.code.trim();
  const name = input.name.trim();
  if (code === '') throw new DomainError('VALIDATION', 'Give the customer a code.', { code: 'Needed.' });
  if (name === '') throw new DomainError('VALIDATION', 'Give the customer a name.', { name: 'Needed.' });
  const emails = [...new Set(input.billingEmails.map((email) => email.trim().toLowerCase()).filter(Boolean))];
  return {
    ...input,
    code,
    name,
    phone: textOrNull(input.phone),
    billingContactName: textOrNull(input.billingContactName),
    billingEmails: emails,
    exemptionNote: textOrNull(input.exemptionNote),
    notes: textOrNull(input.notes),
    billingAddress: cleanAddress(input.billingAddress),
  };
}

export function cleanAddress(address: PostalAddress | null): PostalAddress | null {
  if (!address) return null;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(address)) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (text) out[key] = text;
  }
  return Object.keys(out).length > 0 ? out : null;
}

async function assertUnique(tx: Executor, orgId: string, input: CustomerInput, exceptId: string | null): Promise<void> {
  const result = await tx.execute<{ id: string; code: string; name: string }>(
    sql`select id, code, name from core.customers
         where org_id = ${orgId}::uuid and deleted_at is null and ${exceptId ? sql`id <> ${exceptId}::uuid` : sql`true`}
           and (lower(code) = lower(${input.code}) or lower(name) = lower(${input.name})) limit 1`,
  );
  const clash = result.rows[0];
  if (!clash) return;
  if (clash.code.toLowerCase() === input.code.toLowerCase()) throw new DomainError('CONFLICT', `The code ${clash.code} is already used by ${clash.name}.`, { code: 'Already used.' });
  throw new DomainError('CONFLICT', `A customer named ${clash.name} is already in your list.`, { name: 'Already used.' });
}

async function writeProfile(tx: Transaction, ctx: DomainContext, customerId: string, input: CustomerInput): Promise<void> {
  await tx.execute(sql`
    insert into ledger.customer_profiles (org_id, customer_id, billing_contact_name, billing_emails, billing_address, terms_id, default_tax_rate_id,
                                          tax_exempt, exemption_note, reminders_enabled, notes)
    values (${ctx.orgId}::uuid, ${customerId}::uuid, ${input.billingContactName}, ${sql`array[${sql.join(input.billingEmails.map((email) => sql`${email}`), sql`, `)}]::text[]`},
            ${input.billingAddress ? JSON.stringify(input.billingAddress) : null}::jsonb, ${input.termsId}::uuid, ${input.defaultTaxRateId}::uuid,
            ${input.taxExempt}, ${input.exemptionNote}, ${input.remindersEnabled}, ${input.notes})
    on conflict (org_id, customer_id) do update set
      billing_contact_name = excluded.billing_contact_name, billing_emails = excluded.billing_emails, billing_address = excluded.billing_address,
      terms_id = excluded.terms_id, default_tax_rate_id = excluded.default_tax_rate_id, tax_exempt = excluded.tax_exempt,
      exemption_note = excluded.exemption_note, reminders_enabled = excluded.reminders_enabled, notes = excluded.notes,
      version = ledger.customer_profiles.version + 1, updated_at = now()`);
}

function snapshot(input: CustomerInput): Record<string, unknown> {
  return { ...input };
}

/** Adds a `core.customers` row (code, name, phone) and its Ledger profile inside `tx`. Rights are the caller's job. */
export const insertCustomer = scoped(async function insertCustomer(tx: Transaction, ctx: DomainContext, raw: CustomerInput, meta: Record<string, unknown> = {}): Promise<string> {
  const input = normalize(raw);
  await assertUnique(tx, ctx.orgId, input, null);
  const result = await tx.execute<{ id: string }>(
    sql`insert into core.customers (org_id, code, name, phone, contact_name, contact_email, created_by, updated_by)
        values (${ctx.orgId}::uuid, ${input.code}, ${input.name}, ${input.phone}, ${input.billingContactName}, ${input.billingEmails[0] ?? null},
                ${actorUserId(ctx)}::uuid, ${actorUserId(ctx)}::uuid)
        returning id`,
  );
  const id = result.rows[0]!.id;
  await writeProfile(tx, ctx, id, input);
  await logActivity(tx, ctx, { verb: 'customer.created', entityType: 'customer', entityId: id, after: snapshot(input), meta });
  return id;
}, 1);

/**
 * Saves a customer inside `tx`: the name and phone on the shared row (the code never changes, other
 * apps key on it) and the Ledger profile. `version` is the profile version the person saw.
 */
export const saveCustomer = scoped(async function saveCustomer(tx: Transaction, ctx: DomainContext, id: string, raw: CustomerInput, version: number | null, meta: Record<string, unknown> = {}): Promise<void> {
  const input = normalize(raw);
  const found = await tx.execute<CustomerDbRow>(sql`${SELECT} where c.org_id = ${ctx.orgId}::uuid and c.id = ${id}::uuid and c.deleted_at is null for update of c`);
  const current = found.rows[0];
  if (!current) throw notFound('That customer');
  const before = toDetail(current);
  if (version !== null && before.version !== version) throw conflict('Someone else changed this customer. Here is the new one.');
  if (input.code.toLowerCase() !== before.code.toLowerCase()) {
    throw new DomainError('VALIDATION', `The code ${before.code} is used by other KitStak apps, so it stays.`, { code: 'Cannot change.' });
  }
  await assertUnique(tx, ctx.orgId, input, id);
  if (input.name !== before.name || input.phone !== before.phone) {
    await tx.execute(sql`update core.customers set name = ${input.name}, phone = ${input.phone}, updated_by = ${actorUserId(ctx)}::uuid,
                                version = version + 1, updated_at = now()
                          where org_id = ${ctx.orgId}::uuid and id = ${id}::uuid`);
  }
  await writeProfile(tx, ctx, id, { ...input, code: before.code });
  await logActivity(tx, ctx, {
    verb: 'customer.updated',
    entityType: 'customer',
    entityId: id,
    before: { name: before.name, phone: before.phone, billingEmails: before.billingEmails, termsId: before.termsId, taxExempt: before.taxExempt, remindersEnabled: before.remindersEnabled },
    after: snapshot(input),
    meta,
  });
}, 1);

export const createCustomer = scoped(async function createCustomer(ctx: DomainContext, input: CustomerInput): Promise<string> {
  await requireRight(ctx, 'invoice:write');
  return db.transaction((tx) => insertCustomer(tx, ctx, input));
});

export const updateCustomer = scoped(async function updateCustomer(ctx: DomainContext, id: string, input: CustomerInput, version: number): Promise<void> {
  await requireRight(ctx, 'invoice:write');
  if (!isUuid(id)) throw notFound('That customer');
  await db.transaction((tx) => saveCustomer(tx, ctx, id, input, version));
});
