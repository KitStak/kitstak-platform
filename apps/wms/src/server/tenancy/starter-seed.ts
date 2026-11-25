/**
 * Starter data for a brand-new organization's warehouse: everything the WMS needs to work,
 * none of the demo dataset. Runs on the NEW tenant's handle, inside one transaction.
 *
 *  - company settings (named after the org; default password policy),
 *  - the system roles and their default permissions (+ the Client portal role),
 *  - the global Data Setup lookups, the printout templates and the add-on app catalog
 *    (all add-ons inactive),
 *  - auto code-generation sequences starting at 1,
 *  - the provisioning user as the warehouse's first administrator,
 *  - the org's first warehouse (with its starter Receiving / Shipping / Returns locations,
 *    location zones and groups), assigned to that administrator.
 */
import { z } from 'zod';
import type { AppDb } from '@/server/api/db';
import { buildAuthContext } from '@/server/auth/context';
import { upsertCoreIdentity } from '@/server/auth/credentials';
import { DEFAULT_ROLE_PERMISSIONS, DEFAULT_ROLES } from '@/server/auth/permission-catalog';
import * as schema from '@/server/db/schema';
import { CLIENT_ROLE_KEY, CLIENT_ROLE_PERMISSIONS } from '@/server/db/seed/access';
import { GLOBAL_LOOKUPS, LOCATION_GROUPS, LOCATION_ZONE_SETTINGS, LOCATION_ZONES } from '@/server/db/seed/lookups';
import { SEED_APPS, seedPrintouts } from '@/server/db/seed/platform';
import { firstWarehouseSaveSchema, phoneError, WAREHOUSE_DEFAULTS } from '@/lib/grid-defs/facility/warehouses';
import { createWarehouse } from '@/server/repositories/warehouses';
import type { LookupType } from '@/lib/enums';

/**
 * What the setup form collects about the org's first warehouse. Only the name and the short code
 * are needed (the form fills both in, and the time zone has a default). The address and the
 * contact are optional here: a new trial is not stopped by nine required fields, and they can be
 * added later under Settings, Warehouse. What is typed is still checked.
 */
export const firstWarehouseSchema = z.object({
  name: z.string().trim().min(1, 'Enter the warehouse name').max(120),
  code: z
    .string()
    .trim()
    .min(1, 'Enter a short code')
    .max(20)
    .regex(/^[A-Za-z0-9_-]+$/, 'Letters, numbers, dash or underscore'),
  addressLine: z.string().trim().max(250).default(''),
  city: z.string().trim().max(100).default(''),
  state: z.string().trim().max(60).default(''),
  postalCode: z.string().trim().max(20).default(''),
  country: z.string().trim().min(1).max(60).default('United States'),
  contactName: z.string().trim().max(120).default(''),
  contactPhone: z
    .string()
    .trim()
    .max(40)
    .default('')
    .superRefine((value, ctx) => {
      const problem = phoneError(value);
      if (problem) ctx.addIssue({ code: 'custom', message: problem });
    }),
  timezone: z.string().trim().default('America/Chicago'),
});
export type FirstWarehouseInput = z.input<typeof firstWarehouseSchema>;

export interface StarterAdmin {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
}

const STARTER_SEQUENCES: readonly { key: string; prefix: string; padding: number }[] = [
  { key: 'so', prefix: 'SO', padding: 6 },
  { key: 'po', prefix: 'PO', padding: 6 },
  { key: 'job', prefix: 'Job', padding: 6 },
  { key: 'rma', prefix: 'RMA', padding: 6 },
  { key: 'count', prefix: 'CNT', padding: 6 },
  { key: 'workOrder', prefix: 'WO', padding: 6 },
  { key: 'shipmentPlan', prefix: 'SP', padding: 6 },
  { key: 'wave', prefix: '', padding: 0 },
  { key: 'bill', prefix: '', padding: 3 },
  { key: 'lp', prefix: 'LP', padding: 6 },
  { key: 'receipt', prefix: '', padding: 0 },
];

/** A warehouse code prefix: the code's letters/digits, at most 8 characters. */
export function prefixFromCode(code: string): string {
  return code.replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase() || 'WH';
}

async function seedRoles(tx: AppDb): Promise<string> {
  let adminRoleId = '';
  const insert = async (
    row: typeof schema.roles.$inferInsert,
    permissions: readonly string[],
  ): Promise<string> => {
    const id = (await tx.insert(schema.roles).values(row).returning({ id: schema.roles.id }))[0].id;
    if (permissions.length > 0)
      await tx.insert(schema.rolePermissions).values(permissions.map((permission) => ({ roleId: id, permission })));
    return id;
  };
  for (const r of DEFAULT_ROLES) {
    const id = await insert(
      { key: r.key, name: r.name, description: r.description, category: 'Operation', isSystem: true },
      DEFAULT_ROLE_PERMISSIONS[r.key],
    );
    if (r.key === 'admin') adminRoleId = id;
  }
  await insert(
    {
      key: CLIENT_ROLE_KEY,
      name: 'Client',
      description:
        "Client portal: read-only orders, inventory and reports for the client's own data. Carrier costs and account numbers are hidden.",
      category: 'Client',
      isSystem: true,
      restrictions: ['carrier_cost', 'carrier_account_data', 'rate_shopping_data'],
    },
    CLIENT_ROLE_PERMISSIONS,
  );
  if (!adminRoleId) throw new Error('The admin role is missing from DEFAULT_ROLES');
  return adminRoleId;
}

async function seedGlobalLookups(tx: AppDb): Promise<void> {
  for (const [type, values] of Object.entries(GLOBAL_LOOKUPS) as [LookupType, readonly (string | readonly [string, Record<string, unknown>])[]][]) {
    let sortOrder = 0;
    for (const v of values) {
      const [name, meta] = typeof v === 'string' ? [v, null] : [v[0], v[1]];
      await tx.insert(schema.lookupValues).values({ type, name, sortOrder: sortOrder++, meta });
    }
  }
}

async function seedWarehouseLookups(tx: AppDb, warehouseId: string): Promise<void> {
  let i = 0;
  for (const name of LOCATION_ZONES) {
    const z0 = LOCATION_ZONE_SETTINGS[name];
    await tx.insert(schema.lookupValues).values({
      type: 'location_zone',
      name,
      code: z0.code,
      sortOrder: i++,
      warehouseId,
      meta: { priority: z0.priority, maxLocationsPerSku: z0.maxLocationsPerSku },
    });
  }
  i = 0;
  for (const name of LOCATION_GROUPS)
    await tx.insert(schema.lookupValues).values({ type: 'location_group', name, sortOrder: i++, warehouseId });
}

/** Fills an EMPTY tenant schema (`tx` = a transaction on the tenant handle). */
export async function seedStarterWarehouse(
  tx: AppDb,
  input: {
    readonly orgId: string;
    readonly orgName: string;
    readonly schemaName: string;
    readonly admin: StarterAdmin;
    readonly warehouse: FirstWarehouseInput;
  },
): Promise<{ warehouseId: string; warehouseCode: string }> {
  const first = firstWarehouseSchema.parse(input.warehouse);
  await tx.insert(schema.companySettings).values({
    id: 'company',
    displayName: input.orgName,
    fullName: input.orgName,
    defaults: { currency: 'USD', dateFormat: 'M/D/YYYY h:mm:ss A', weightUnit: 'Pound', dimensionUnit: 'Inch' },
    passwordPolicy: {
      minLength: 12,
      requireUpper: true,
      requireNumber: true,
      requireSymbol: true,
      maxAgeDays: 180,
      lockoutThreshold: 5,
      lockoutMinutes: 15,
    },
  });
  const adminRoleId = await seedRoles(tx);
  await seedGlobalLookups(tx);
  await seedPrintouts(tx);
  await tx.insert(schema.apps).values(
    SEED_APPS.map(([key, name, description, category]) => ({ key, name, description, category, isActive: false })),
  );
  await tx
    .insert(schema.codeSequences)
    .values(STARTER_SEQUENCES.map((s) => ({ ...s, nextValue: 1, warehouseId: '*', autoGenerate: true })));

  // The provisioning user: an EXISTING KitStak account (their own name, email, credential).
  const now = new Date().toISOString();
  const [firstName, ...rest] = input.admin.name.trim().split(/\s+/);
  await tx.insert(schema.users).values({
    id: input.admin.userId,
    email: input.admin.email.toLowerCase(),
    name: input.admin.name,
    firstName: firstName ?? input.admin.name,
    lastName: rest.join(' ') || null,
    // Frozen legacy mirror column: credentials live in core.account and are never set here.
    passwordHash: '!',
    role: 'admin',
    userType: 'Operation',
    isActive: true,
    allClients: true,
    passwordChangedAt: now,
  });
  await upsertCoreIdentity(tx, {
    userId: input.admin.userId,
    email: input.admin.email,
    name: input.admin.name,
    legacyRole: 'admin',
    userType: 'Operation',
    isApiUser: false,
    allClients: true,
    passwordChangedAt: new Date(now),
  });
  await tx.insert(schema.userRoles).values({ userId: input.admin.userId, roleId: adminRoleId });

  // The org's first warehouse, through the same path the Warehouses screen uses.
  const auth = await buildAuthContext(tx, {
    id: input.admin.userId,
    email: input.admin.email,
    name: input.admin.name,
    role: 'admin',
    userType: 'Operation',
    allClients: true,
    isApiUser: false,
    sessionId: 'provisioning',
    sessionVersion: 1,
    sessionExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    orgId: input.orgId,
    orgName: input.orgName,
    orgSlug: '',
    tenantSchema: input.schemaName,
  });
  const save = firstWarehouseSaveSchema.parse({
    ...WAREHOUSE_DEFAULTS,
    ...first,
    prefix: prefixFromCode(first.code),
    email: input.admin.email,
    createStarterLocations: true,
  });
  const created = await createWarehouse(tx, auth, { userId: input.admin.userId, source: input.admin.email }, save);
  await seedWarehouseLookups(tx, created.id);
  await tx.insert(schema.userWarehouses).values({ userId: input.admin.userId, warehouseId: created.id });
  return { warehouseId: created.id, warehouseCode: created.code };
}
