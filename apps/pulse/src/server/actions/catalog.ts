'use server';
import { z } from 'zod';
import {
  createClient,
  createItem,
  createJobType,
  createVasService,
  deleteClient,
  deleteItem,
  deleteJobType,
  deleteVasService,
  restoreClient,
  restoreVasService,
  updateClient,
  updateItem,
  updateJobType,
  updateVasService,
} from '@/server/domain';
import { runAction } from './_action';
import { bp, code, color, name, pace, partsOwner, pricingModel, text, unitPrice, uuid, vasBilling, version } from './schemas';

const clientFields = {
  code: code.nullable().optional(),
  name: name(200),
  status: z.enum(['active', 'inactive']).optional(),
  contactName: text(200).nullable().optional(),
  contactEmail: z.union([z.email('That email does not look right.'), z.literal('')]).nullable().optional(),
  phone: text(60).nullable().optional(),
  targetMarginBp: bp.nullable().optional(),
  paymentTermsDays: z.number().int().min(0).max(3650).nullable().optional(),
  partsOwner: partsOwner.nullable().optional(),
  notes: text(5000).nullable().optional(),
  color: color.optional(),
  coreCustomerId: uuid.nullable().optional(),
  crmAccountItemId: uuid.nullable().optional(),
};
const createClientSchema = z.object(clientFields);
export type CreateClientActionInput = z.input<typeof createClientSchema>;
export async function createClientAction(input: CreateClientActionInput) {
  return runAction(createClientSchema, input, (data, ctx) => createClient(ctx, data));
}

const updateClientSchema = z.object({ clientId: uuid, patch: z.object(clientFields).partial(), version });
export async function updateClientAction(input: z.input<typeof updateClientSchema>) {
  return runAction(updateClientSchema, input, (data, ctx) => updateClient(ctx, data.clientId, data.patch, data.version));
}

const clientIdSchema = z.object({ clientId: uuid });
export async function deleteClientAction(input: z.input<typeof clientIdSchema>) {
  return runAction(clientIdSchema, input, (data, ctx) => deleteClient(ctx, data.clientId));
}
export async function restoreClientAction(input: z.input<typeof clientIdSchema>) {
  return runAction(clientIdSchema, input, (data, ctx) => restoreClient(ctx, data.clientId));
}

const jobTypeFields = {
  code: code.nullable().optional(),
  name: name(120),
  unitLabel: z.string().trim().min(1).max(30).optional(),
  defaultPricingModel: pricingModel.optional(),
  defaultLaborClassId: uuid.nullable().optional(),
  defaultStandardUph: pace.nullable().optional(),
  targetMarginBp: bp.nullable().optional(),
  color: color.optional(),
  icon: z.string().max(40).nullable().optional(),
  position: z.number().int().min(0).max(10_000).optional(),
};
const createJobTypeSchema = z.object(jobTypeFields);
export async function createJobTypeAction(input: z.input<typeof createJobTypeSchema>) {
  return runAction(createJobTypeSchema, input, (data, ctx) => createJobType(ctx, data));
}

const updateJobTypeSchema = z.object({ jobTypeId: uuid, patch: z.object({ ...jobTypeFields, archived: z.boolean() }).partial() });
export async function updateJobTypeAction(input: z.input<typeof updateJobTypeSchema>) {
  return runAction(updateJobTypeSchema, input, (data, ctx) => updateJobType(ctx, data.jobTypeId, data.patch));
}

const jobTypeIdSchema = z.object({ jobTypeId: uuid });
export async function deleteJobTypeAction(input: z.input<typeof jobTypeIdSchema>) {
  return runAction(jobTypeIdSchema, input, (data, ctx) => deleteJobType(ctx, data.jobTypeId));
}

const itemFields = { sku: code, name: name(200), uom: z.string().trim().min(1).max(20).optional(), unitCost: unitPrice.optional(), suppliedBy: partsOwner.nullable().optional(), clientId: uuid.nullable().optional() };
const createItemSchema = z.object(itemFields);
export async function createItemAction(input: z.input<typeof createItemSchema>) {
  return runAction(createItemSchema, input, (data, ctx) => createItem(ctx, data));
}

const updateItemSchema = z.object({ itemId: uuid, patch: z.object(itemFields).partial(), version });
export async function updateItemAction(input: z.input<typeof updateItemSchema>) {
  return runAction(updateItemSchema, input, (data, ctx) => updateItem(ctx, data.itemId, data.patch, data.version));
}

const itemIdSchema = z.object({ itemId: uuid });
export async function deleteItemAction(input: z.input<typeof itemIdSchema>) {
  return runAction(itemIdSchema, input, (data, ctx) => deleteItem(ctx, data.itemId));
}

const serviceFields = {
  code: code.nullable().optional(),
  name: name(200),
  unitLabel: z.string().trim().min(1).max(30).optional(),
  billing: vasBilling.optional(),
  defaultPrice: unitPrice.nullable().optional(),
  defaultCostPerUnit: unitPrice.nullable().optional(),
  standardUph: pace.nullable().optional(),
  defaultLaborClassId: uuid.nullable().optional(),
  color: color.optional(),
  active: z.boolean().optional(),
};
const createServiceSchema = z.object(serviceFields);
export async function createVasServiceAction(input: z.input<typeof createServiceSchema>) {
  return runAction(createServiceSchema, input, (data, ctx) => createVasService(ctx, data));
}

const updateServiceSchema = z.object({ serviceId: uuid, patch: z.object(serviceFields).partial(), version });
export async function updateVasServiceAction(input: z.input<typeof updateServiceSchema>) {
  return runAction(updateServiceSchema, input, (data, ctx) => updateVasService(ctx, data.serviceId, data.patch, data.version));
}

const serviceIdSchema = z.object({ serviceId: uuid });
export async function deleteVasServiceAction(input: z.input<typeof serviceIdSchema>) {
  return runAction(serviceIdSchema, input, (data, ctx) => deleteVasService(ctx, data.serviceId));
}

/** Undo of a deleted extra service. */
export async function restoreVasServiceAction(input: z.input<typeof serviceIdSchema>) {
  return runAction(serviceIdSchema, input, (data, ctx) => restoreVasService(ctx, data.serviceId));
}
