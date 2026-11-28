'use server';
/** Customer and vendor actions (SPEC 5.1, 5.2). The domain checks the Ledger right of each. */
import { z } from 'zod';
import { createCustomer, updateCustomer } from '@/server/domain/customers';
import { archiveVendor, createVendor, restoreVendor, updateVendor } from '@/server/domain/vendors';
import { VENDOR_KINDS } from '@/lib/vendor-kinds';
import { runAction, type ActionResult } from './_action';

const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => text(max).nullable().optional().transform((value) => (value ? value : null));
const optionalId = z.uuid().nullable().optional().transform((value) => value ?? null);

const address = z
  .object({ line1: text(200).optional(), city: text(120).optional(), region: text(120).optional(), postalCode: text(40).optional(), country: text(80).optional() })
  .nullable()
  .optional()
  .transform((value) => value ?? null);

const customerSchema = z.object({
  code: text(40).min(1, 'Give the customer a code.'),
  name: text(200).min(1, 'Give the customer a name.'),
  phone: optionalText(60),
  billingContactName: optionalText(200),
  billingEmails: z.array(z.email('That is not an email address.').max(200)).max(10, 'Give 10 email addresses at most.'),
  billingAddress: address,
  termsId: optionalId,
  defaultTaxRateId: optionalId,
  taxExempt: z.boolean(),
  exemptionNote: optionalText(500),
  remindersEnabled: z.boolean(),
  notes: optionalText(2000),
});

export async function createCustomerAction(input: z.input<typeof customerSchema>): Promise<ActionResult<{ id: string }>> {
  return runAction(customerSchema, input, async (data, ctx) => ({ id: await createCustomer(ctx, data) }));
}

const updateCustomerSchema = customerSchema.extend({ id: z.uuid(), version: z.number().int().min(0) });

export async function updateCustomerAction(input: z.input<typeof updateCustomerSchema>): Promise<ActionResult<void>> {
  return runAction(updateCustomerSchema, input, (data, ctx) => {
    const { id, version, ...rest } = data;
    return updateCustomer(ctx, id, rest, version);
  });
}

const vendorSchema = z.object({
  name: text(200).min(1, 'Give the vendor a name.'),
  kinds: z.array(z.enum(VENDOR_KINDS)).max(VENDOR_KINDS.length),
  email: z
    .union([z.email('That is not an email address.'), z.literal('')])
    .nullable()
    .optional()
    .transform((value) => value || null),
  phone: optionalText(60),
  address,
  notes: optionalText(2000),
  termsId: optionalId,
  defaultAccountId: optionalId,
  tracks1099: z.boolean(),
  w9OnFile: z.boolean(),
});

export async function createVendorAction(input: z.input<typeof vendorSchema>): Promise<ActionResult<{ id: string }>> {
  return runAction(vendorSchema, input, async (data, ctx) => ({ id: await createVendor(ctx, data) }));
}

const updateVendorSchema = vendorSchema.extend({
  id: z.uuid(),
  version: z.number().int().min(0),
  confirmRemoveKinds: z.array(z.enum(VENDOR_KINDS)).optional(),
});

export async function updateVendorAction(input: z.input<typeof updateVendorSchema>): Promise<ActionResult<void>> {
  return runAction(updateVendorSchema, input, (data, ctx) => {
    const { id, version, confirmRemoveKinds, ...rest } = data;
    return updateVendor(ctx, id, rest, { version, confirmRemoveKinds });
  });
}

const archiveSchema = z.object({ id: z.uuid(), archived: z.boolean(), confirmCrew: z.boolean().optional() });

export async function setVendorArchivedAction(input: z.input<typeof archiveSchema>): Promise<ActionResult<void>> {
  return runAction(archiveSchema, input, (data, ctx) => (data.archived ? archiveVendor(ctx, data.id, { confirmCrew: data.confirmCrew }) : restoreVendor(ctx, data.id)));
}
