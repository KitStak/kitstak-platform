/**
 * Custom field definitions (BUILD_PLAN F7 `/api/custom-fields`): each entity has fixed
 * slots (textBox1..3, dropDown1..2, date1..3, toggle1..2) that an admin names and enables.
 * Reading is open to every signed-in user (forms render the fields); changing a
 * definition needs that entity's "Custom Field Management" permission.
 */
import { and, eq } from 'drizzle-orm';
import { asc } from '@/server/db/order';
import { z } from 'zod';
import {
  CUSTOM_FIELD_ENTITIES,
  CUSTOM_FIELD_SLOTS,
  type CustomFieldEntity,
  type CustomFieldSlot,
} from '@/lib/enums';
import type { AppDb } from '@/server/api/db';
import { AppError, forbiddenError, notFoundError, validationError } from '@/server/api/errors';
import type { AuthContext } from '@/server/auth/context';
import { can } from '@/server/auth/permissions';
import { customFieldDefs } from '@/server/db/schema';
import { assertVersion, versionSchema } from './platform-common';

export type CustomFieldDefRow = typeof customFieldDefs.$inferSelect;

export const CUSTOM_FIELD_PERMISSIONS: Readonly<Record<CustomFieldEntity, string>> = {
  shipment_order: 'fulfillment.shipment_orders.custom_field_management',
  purchase_order: 'inventory.purchase_orders.custom_field_management',
  product: 'settings.products.custom_field_management',
  location: 'settings.locations.custom_field_management',
  work_order: 'inventory.work_orders.custom_field_management',
  lp_type: 'settings.lp_types.custom_field_management',
  shipment_package: 'settings.shipment_packages.custom_field_management',
  retailer: 'settings.retailers.custom_field_management',
  shipment_plan: 'fulfillment.shipment_plan.custom_field_management',
  client: 'settings.clients.edit',
};

export const ANY_CUSTOM_FIELD_PERMISSION: readonly string[] = [
  ...new Set(Object.values(CUSTOM_FIELD_PERMISSIONS)),
];

const optionsSchema = z.array(z.string().trim().min(1).max(100)).max(200);

export const customFieldListQuerySchema = z.object({
  entityType: z.enum(CUSTOM_FIELD_ENTITIES).optional(),
  includeInactive: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export const customFieldCreateSchema = z.object({
  entityType: z.enum(CUSTOM_FIELD_ENTITIES),
  slot: z.enum(CUSTOM_FIELD_SLOTS),
  name: z.string().trim().min(1, 'Name is required').max(60),
  options: optionsSchema.nullish(),
  isActive: z.boolean().default(true),
});

export const customFieldUpdateSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  options: optionsSchema.nullish(),
  isActive: z.boolean().optional(),
  version: versionSchema.optional(),
});

const isDropDown = (slot: CustomFieldSlot): boolean => slot.startsWith('dropDown');

function normalizeOptions(
  slot: CustomFieldSlot,
  options: readonly string[] | null | undefined,
): string[] | null {
  if (!isDropDown(slot)) {
    if (options && options.length > 0)
      throw validationError('Only drop-down fields have options', { options: ['Remove the options'] });
    return null;
  }
  const unique = [...new Set(options ?? [])];
  if (unique.length === 0)
    throw validationError('Drop-down fields need at least one option', {
      options: ['Add at least one option'],
    });
  return unique;
}

function assertCanManage(auth: AuthContext, entityType: CustomFieldEntity): void {
  if (!can(auth, CUSTOM_FIELD_PERMISSIONS[entityType])) throw forbiddenError();
}

export async function listCustomFields(
  db: AppDb,
  query: z.output<typeof customFieldListQuerySchema>,
): Promise<CustomFieldDefRow[]> {
  const where = and(
    query.entityType ? eq(customFieldDefs.entityType, query.entityType) : undefined,
    query.includeInactive ? undefined : eq(customFieldDefs.isActive, true),
  );
  return await db
    .select()
    .from(customFieldDefs)
    .where(where)
    .orderBy(asc(customFieldDefs.entityType), asc(customFieldDefs.slot));
}

export async function getCustomField(db: AppDb, id: string): Promise<CustomFieldDefRow> {
  const row = (await db.select().from(customFieldDefs).where(eq(customFieldDefs.id, id)).limit(1))[0];
  if (!row) throw notFoundError('Custom field');
  return row;
}

export async function createCustomField(
  db: AppDb,
  auth: AuthContext,
  input: z.output<typeof customFieldCreateSchema>,
): Promise<CustomFieldDefRow> {
  assertCanManage(auth, input.entityType);
  const clash = (
    await db
      .select({ id: customFieldDefs.id })
      .from(customFieldDefs)
      .where(and(eq(customFieldDefs.entityType, input.entityType), eq(customFieldDefs.slot, input.slot)))
      .limit(1)
  )[0];
  if (clash)
    throw new AppError('DUPLICATE', `The ${input.slot} slot is already defined`, {
      fieldErrors: { slot: ['Slot already in use'] },
    });
  return (
    await db
      .insert(customFieldDefs)
      .values({
        entityType: input.entityType,
        slot: input.slot,
        name: input.name,
        options: normalizeOptions(input.slot, input.options),
        isActive: input.isActive,
        createdBy: auth.user.id,
        updatedBy: auth.user.id,
      })
      .returning()
  )[0];
}

export async function updateCustomField(
  db: AppDb,
  auth: AuthContext,
  id: string,
  input: z.output<typeof customFieldUpdateSchema>,
): Promise<CustomFieldDefRow> {
  const current = await getCustomField(db, id);
  assertCanManage(auth, current.entityType);
  assertVersion(current.version, input.version);
  return (
    await db
      .update(customFieldDefs)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.options !== undefined ? { options: normalizeOptions(current.slot, input.options) } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        updatedBy: auth.user.id,
        version: current.version + 1,
      })
      .where(eq(customFieldDefs.id, id))
      .returning()
  )[0];
}
