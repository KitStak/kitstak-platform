/**
 * One separate warehouse per organization: schema clone fidelity, provisioning, data
 * isolation (Drizzle AND raw SQL), org choice, identity guards and the tenant migration
 * stream — on a real (in-memory PGlite) database with the committed migrations.
 */
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { member, organization, user, wmsTenants } from '@kitstak/db/schema';
import { wmsSchemaNameForOrg } from '@kitstak/db/wms-tenants';
import type { AppDb } from '@/server/api/db';
import { ensurePlatformOrg, identityManagedHere, warehouseOrgId } from '@/server/auth/credentials';
import { companySettings, users, warehouses } from '@/server/db/schema';
import { dbAll, dbGet, withWriteTx } from '@/server/db/sql';
import { buildTenantDb, currentWmsSchema, rewriteTenantSql } from '@/server/db/tenant';
import { migrateTenantSchema } from '@/server/tenancy/migrations';
import { provisionWarehouse } from '@/server/tenancy/provision';
import { listWmsOrgs, pickWmsOrg, rankWmsOrgs, setupCandidates, type WmsOrgChoice } from '@/server/tenancy/registry';
import { loadWarehouseAccess } from '@/server/auth/session-store';
import { createTestDb, type TestDb } from '../../setup/test-db';

const WAREHOUSE = {
  name: 'Acme Main',
  code: 'ACME1',
  addressLine: '100 Dock St',
  city: 'Dallas',
  state: 'TX',
  postalCode: '75201',
  country: 'United States',
  contactName: 'Ada Owner',
  contactPhone: '214-555-0100',
  timezone: 'America/Chicago',
};

let t: TestDb;
let platform: AppDb;
let tenants: Map<string, AppDb>;
const tenantDb = async (schema: string): Promise<AppDb> => {
  let db = tenants.get(schema);
  if (!db) {
    db = await buildTenantDb({ kind: 'pglite', client: t.pg }, schema);
    tenants.set(schema, db);
  }
  return db;
};

async function addOrg(slug: string): Promise<string> {
  const id = randomUUID();
  await platform.insert(organization).values({ id, name: `${slug} Inc`, slug, createdAt: new Date() });
  return id;
}

async function addUser(email: string, memberships: readonly [string, string][]): Promise<string> {
  const id = randomUUID();
  await platform.insert(user).values({ id, name: 'Ada Owner', email, emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
  for (const [organizationId, role] of memberships)
    await platform.insert(member).values({ id: randomUUID(), organizationId, userId: id, role, createdAt: new Date() });
  return id;
}

beforeEach(async () => {
  t = await createTestDb();
  platform = t.db;
  tenants = new Map();
});

afterEach(async () => {
  const schemas = await dbAll<{ s: string }>(
    platform,
    sql`SELECT nspname AS s FROM pg_namespace WHERE nspname ~ '^wms_[0-9a-f]{32}$'`,
  );
  for (const { s } of schemas) await t.pg.exec(`DROP SCHEMA "${s}" CASCADE`);
  await t.close();
});

describe('rewriteTenantSql', () => {
  const schema = 'wms_0123456789abcdef0123456789abcdef';
  it('retargets quoted and bare wms references but not string literals', () => {
    expect(rewriteTenantSql('select * from "wms"."orders" join "wms"."lines" on 1=1', schema)).toBe(
      `select * from "${schema}"."orders" join "${schema}"."lines" on 1=1`,
    );
    expect(rewriteTenantSql('CREATE TABLE IF NOT EXISTS wms.pack_drafts (x int)', schema)).toBe(
      `CREATE TABLE IF NOT EXISTS ${schema}.pack_drafts (x int)`,
    );
    expect(rewriteTenantSql("select 'wms.orders.read' as k, kitstak_wms.x", schema)).toBe(
      "select 'wms.orders.read' as k, kitstak_wms.x",
    );
  });
  it('is the identity for the platform schema', () => {
    expect(rewriteTenantSql('select * from "wms"."orders"', 'wms')).toBe('select * from "wms"."orders"');
  });
});

describe('provisioning an org warehouse', () => {
  async function provisionAcme() {
    await ensurePlatformOrg(platform);
    const orgId = await addOrg('acme');
    const ownerId = await addUser('ada@acme.example', [[orgId, 'owner']]);
    const result = await provisionWarehouse(platform, { tenantDb }, { orgId, userId: ownerId, warehouse: WAREHOUSE });
    return { orgId, ownerId, result, tenant: await tenantDb(result.schemaName) };
  }

  it('clones the full wms structure into an empty schema', async () => {
    const { result } = await provisionAcme();
    const target = result.schemaName;
    expect(target).toMatch(/^wms_[0-9a-f]{32}$/);
    const normalize = (v: string) => v.replaceAll(`${target}.`, 'wms.').replaceAll(`"${target}".`, '"wms".');
    const columns = async (schema: string) =>
      (
        await dbAll<{ k: string }>(
          platform,
          sql`SELECT table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '') AS k
              FROM information_schema.columns WHERE table_schema = ${schema} ORDER BY 1`,
        )
      ).map((r) => normalize(r.k));
    const indexes = async (schema: string) =>
      (
        await dbAll<{ k: string }>(platform, sql`SELECT indexdef AS k FROM pg_indexes WHERE schemaname = ${schema} ORDER BY indexname`)
      ).map((r) => normalize(r.k));
    // Printed with search_path = pg_catalog so every schema's references are qualified alike.
    const constraints = async (schema: string) =>
      (
        await platform.transaction(async (tx) => {
          await tx.execute(sql`SELECT set_config('search_path', 'pg_catalog', true)`);
          return await dbAll<{ k: string }>(
          tx,
          sql`SELECT c.relname || ':' || k.conname || ':' || k.contype::text || ':' || pg_get_constraintdef(k.oid) AS k FROM pg_constraint k
              JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = ${schema} ORDER BY 1`,
          );
        })
      ).map((r) => normalize(r.k));
    const rls = async (schema: string) =>
      (
        await dbAll<{ k: string }>(
          platform,
          sql`SELECT c.relname || ':' || c.relrowsecurity::text AS k FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = ${schema} AND c.relkind = 'r' ORDER BY 1`,
        )
      ).map((r) => r.k);
    expect(await columns(target)).toEqual(await columns('wms'));
    expect(await indexes(target)).toEqual(await indexes('wms'));
    expect(await constraints(target)).toEqual(await constraints('wms'));
    expect(await rls(target)).toEqual(await rls('wms'));
    expect(result.clone.tables).toBeGreaterThan(100);
    expect(result.clone.triggers).toBeGreaterThan(0);
  });

  it('seeds a usable starter warehouse with the owner as admin, and activates the registry row', async () => {
    const { orgId, ownerId, result, tenant } = await provisionAcme();
    const [company] = await tenant.select().from(companySettings);
    expect(company?.displayName).toBe('acme Inc');
    const whs = await tenant.select({ code: warehouses.code, isDefault: warehouses.isDefault }).from(warehouses);
    expect(whs).toEqual([{ code: 'ACME1', isDefault: true }]);
    const [admin] = await tenant.select({ id: users.id, role: users.role }).from(users);
    expect(admin).toEqual({ id: ownerId, role: 'admin' });
    const [row] = await platform.select().from(wmsTenants).where(eq(wmsTenants.orgId, orgId));
    expect(row).toMatchObject({ schemaName: result.schemaName, status: 'active', provisionedBy: ownerId });
    // The org owner stays an owner (WMS never downgrades a portal-granted role).
    const [m] = await platform.select({ role: member.role }).from(member).where(eq(member.userId, ownerId));
    expect(m?.role).toBe('owner');
    // The platform warehouse is untouched.
    expect(await platform.select().from(warehouses)).toEqual([]);
  });

  it('refuses non-admin members, repeats and unentitled-looking states clearly', async () => {
    await ensurePlatformOrg(platform);
    const orgId = await addOrg('beta');
    const memberId = await addUser('m@beta.example', [[orgId, 'member']]);
    await expect(
      provisionWarehouse(platform, { tenantDb }, { orgId, userId: memberId, warehouse: WAREHOUSE }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const outsider = await addUser('x@other.example', []);
    await expect(
      provisionWarehouse(platform, { tenantDb }, { orgId, userId: outsider, warehouse: WAREHOUSE }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const ownerId = await addUser('o@beta.example', [[orgId, 'owner']]);
    await provisionWarehouse(platform, { tenantDb }, { orgId, userId: ownerId, warehouse: WAREHOUSE });
    await expect(
      provisionWarehouse(platform, { tenantDb }, { orgId, userId: ownerId, warehouse: WAREHOUSE }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('drops the half-built schema when the starter seed fails', async () => {
    await ensurePlatformOrg(platform);
    const orgId = await addOrg('gamma');
    const ownerId = await addUser('o@gamma.example', [[orgId, 'owner']]);
    await expect(
      provisionWarehouse(platform, { tenantDb }, { orgId, userId: ownerId, warehouse: { ...WAREHOUSE, code: 'bad code!' } }),
    ).rejects.toThrow();
    expect(await platform.select().from(wmsTenants).where(eq(wmsTenants.orgId, orgId))).toEqual([]);
    const ns = await dbGet<{ n: number }>(
      platform,
      sql`SELECT count(*)::int AS n FROM pg_namespace WHERE nspname = ${wmsSchemaNameForOrg(orgId)}`,
    );
    expect(ns?.n).toBe(0);
  });

  it('isolates data between warehouses for Drizzle, raw SQL and transactions', async () => {
    const { tenant, result } = await provisionAcme();
    await platform
      .insert(warehouses)
      .values({ id: 'wh-platform', code: 'PLAT', name: 'Platform', addressLine: '1', city: 'X', state: 'TX' });

    // Drizzle reads: each handle sees only its own warehouse rows.
    expect((await platform.select({ code: warehouses.code }).from(warehouses)).map((r) => r.code)).toEqual(['PLAT']);
    expect((await tenant.select({ code: warehouses.code }).from(warehouses)).map((r) => r.code)).toEqual(['ACME1']);
    // Raw, unqualified SQL resolves through the tenant's search_path.
    expect((await dbGet<{ n: number }>(tenant, sql`SELECT count(*)::int AS n FROM warehouses WHERE code = 'PLAT'`))?.n).toBe(0);
    expect((await dbGet<{ code: string }>(tenant, sql`SELECT code FROM warehouses`))?.code).toBe('ACME1');
    // Writes land in the tenant schema only — also inside a (write-locked) transaction.
    await withWriteTx(tenant, async (tx) => {
      await tx.insert(warehouses).values({ id: 'wh-acme-2', code: 'ACME2', name: 'Acme 2', addressLine: '2', city: 'Y', state: 'TX' });
      expect(await currentWmsSchema(tx)).toBe(result.schemaName);
      expect((await dbGet<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM warehouses`))?.n).toBe(2);
    });
    expect(await platform.select().from(warehouses).where(eq(warehouses.code, 'ACME2'))).toEqual([]);
    expect(await currentWmsSchema(platform)).toBe('wms');
    expect(await warehouseOrgId(tenant)).not.toBe(await warehouseOrgId(platform));
  });
});

describe('org choice', () => {
  const choice = (over: Partial<WmsOrgChoice>): WmsOrgChoice => ({
    orgId: randomUUID(),
    name: 'Org',
    slug: 'org',
    memberRole: 'member',
    schemaName: null,
    entitled: true,
    ...over,
  });
  it('prefers the switcher cookie, then the active org, then the platform org', () => {
    const plat = choice({ schemaName: 'wms', slug: 'kitstak' });
    const acme = choice({ schemaName: 'wms_0123456789abcdef0123456789abcdef' });
    const unprovisioned = choice({ memberRole: 'owner' });
    const all = [acme, plat, unprovisioned];
    expect(pickWmsOrg(all, { cookieOrgId: acme.orgId })).toBe(acme);
    expect(pickWmsOrg(all, { cookieOrgId: unprovisioned.orgId, activeOrgId: acme.orgId })).toBe(acme);
    expect(pickWmsOrg(all, {})).toBe(plat);
    expect(pickWmsOrg([unprovisioned], {})).toBeNull();
    expect(setupCandidates(all)).toEqual([unprovisioned]);
  });
  it('ranks every warehouse so resolution can fall through to the next one', () => {
    const plat = choice({ schemaName: 'wms', slug: 'kitstak' });
    const acme = choice({ schemaName: 'wms_0123456789abcdef0123456789abcdef' });
    const locked = choice({ schemaName: 'wms_fedcba9876543210fedcba9876543210', entitled: false });
    expect(rankWmsOrgs([locked, plat, acme], { cookieOrgId: acme.orgId })).toEqual([acme, plat, locked]);
  });
  it('falls back to a provisioned but unentitled org (the locked page) before "no warehouse"', () => {
    const locked = choice({ schemaName: 'wms_0123456789abcdef0123456789abcdef', entitled: false });
    expect(pickWmsOrg([locked], {})).toBe(locked);
  });
  it('lists the platform org as owning wms even before it is registered', async () => {
    const orgId = await addOrg('kitstak');
    const userId = await addUser('u@kitstak.example', [[orgId, 'member']]);
    const [only] = await listWmsOrgs(platform, userId);
    expect(only).toMatchObject({ orgId, schemaName: 'wms' });
  });
});

describe('shared identities', () => {
  it('are only managed by a warehouse whose org is their only org', async () => {
    const platformOrg = await ensurePlatformOrg(platform);
    const orgId = await addOrg('delta');
    const ownerId = await addUser('o@delta.example', [[orgId, 'owner']]);
    const { schemaName } = await provisionWarehouse(platform, { tenantDb }, { orgId, userId: ownerId, warehouse: WAREHOUSE });
    const tenant = await tenantDb(schemaName);
    expect(await identityManagedHere(tenant, ownerId)).toBe(true);
    await platform.insert(member).values({ id: randomUUID(), organizationId: platformOrg, userId: ownerId, role: 'member', createdAt: new Date() });
    expect(await identityManagedHere(tenant, ownerId)).toBe(false);
    expect(await identityManagedHere(platform, ownerId)).toBe(false);
  });
});

describe('tenant migration stream', () => {
  it('applies each entry once to every schema, recording it per schema', async () => {
    await ensurePlatformOrg(platform);
    const orgId = await addOrg('epsilon');
    const ownerId = await addUser('o@eps.example', [[orgId, 'owner']]);
    const { schemaName } = await provisionWarehouse(platform, { tenantDb }, { orgId, userId: ownerId, warehouse: WAREHOUSE });
    const migration = { name: '9001_test_note', sql: 'ALTER TABLE __TENANT__.warehouses ADD COLUMN test_note text' };
    for (const schema of ['wms', schemaName]) {
      expect((await migrateTenantSchema(platform, schema, [migration])).applied).toEqual(['9001_test_note']);
      expect((await migrateTenantSchema(platform, schema, [migration])).applied).toEqual([]);
      const col = await dbGet<{ n: number }>(
        platform,
        sql`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema = ${schema} AND table_name = 'warehouses' AND column_name = 'test_note'`,
      );
      expect(col?.n).toBe(1);
    }
    await t.pg.exec('ALTER TABLE wms.warehouses DROP COLUMN test_note');
    await t.pg.exec(`DELETE FROM wms.__tenant_migrations WHERE name = '9001_test_note'`);
  });
});

describe('warehouse access', () => {
  it('requires an active profile in THAT warehouse, not just org membership', async () => {
    await ensurePlatformOrg(platform);
    const orgId = await addOrg('zeta');
    const ownerId = await addUser('o@zeta.example', [[orgId, 'owner']]);
    const memberId = await addUser('m@zeta.example', [[orgId, 'member']]);
    const { schemaName } = await provisionWarehouse(platform, { tenantDb }, { orgId, userId: ownerId, warehouse: WAREHOUSE });
    expect(await loadWarehouseAccess(platform, schemaName, ownerId, tenantDb)).toMatchObject({ ok: true, role: 'admin' });
    expect(await loadWarehouseAccess(platform, schemaName, memberId, tenantDb)).toEqual({ ok: false, reason: 'no_profile' });
    // The owner has no profile in the platform warehouse.
    expect(await loadWarehouseAccess(platform, 'wms', ownerId, tenantDb)).toEqual({ ok: false, reason: 'no_profile' });
    const tenant = await tenantDb(schemaName);
    await tenant.update(users).set({ isActive: false }).where(eq(users.id, ownerId));
    expect(await loadWarehouseAccess(platform, schemaName, ownerId, tenantDb)).toEqual({ ok: false, reason: 'user_inactive' });
  });
});

describe('runtime SQL never names the platform schema in forms the tenant rewriter cannot see', () => {
  it('has no ::wms., =wms. or quoted wms. references in src', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          fs.readFileSync(full, 'utf8')
            .split('\n')
            .forEach((line, i) => {
              if (/^\s*(\/\/|\*)/.test(line)) return;
              // `wms.` right after a cast, `=`, or a quote/backtick: a sequence/regclass literal or
              // glued SQL the bare-prefix rewriter does not retarget (it would hit the platform schema).
              if (/(::|=|['"`])wms\.[a-z_]/.test(line)) offenders.push(`${path.relative(process.cwd(), full)}:${i + 1}`);
            });
        }
      }
    };
    walk(path.join(process.cwd(), 'src'));
    expect(offenders).toEqual([]);
  });
});

describe('core identity email clashes', () => {
  it('refuses to take over another account email instead of deleting that account', async () => {
    const { upsertCoreIdentity } = await import('@/server/auth/credentials');
    await ensurePlatformOrg(platform);
    const orgId = await addOrg('eta');
    const ownerId = await addUser('o@eta.example', [[orgId, 'owner']]);
    const { schemaName } = await provisionWarehouse(platform, { tenantDb }, { orgId, userId: ownerId, warehouse: WAREHOUSE });
    const victim = await addUser('victim@elsewhere.example', []); // no org at all
    await expect(
      upsertCoreIdentity(await tenantDb(schemaName), {
        userId: ownerId,
        email: 'victim@elsewhere.example',
        name: 'Ada Owner',
        legacyRole: 'admin',
        userType: 'Operation',
        isApiUser: false,
        allClients: true,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(await platform.select({ id: user.id }).from(user).where(eq(user.id, victim))).toEqual([{ id: victim }]);
  });
});
