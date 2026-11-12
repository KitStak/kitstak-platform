/**
 * WMS link service integration tests (search core customers, link/unlink account items)
 * against the dev Postgres (embedded, port 5544). Requires the @kitstak/db core migrations
 * (`pnpm --filter @kitstak/db db:migrate`) so `core.customers` / `crm.customer_links` exist;
 * skipped when the database or those tables are not available.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestOrgs, ctxFor, databaseAvailable, type TestOrg } from './db-fixture';

async function coreTablesAvailable(): Promise<boolean> {
  if (!(await databaseAvailable())) return false;
  const pg = (await import('pg')).default;
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 1_500,
  });
  try {
    await client.connect();
    const result = await client.query<{ ok: boolean }>(
      "select to_regclass('core.customers') is not null and to_regclass('crm.customer_links') is not null as ok",
    );
    return result.rows[0]?.ok === true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

const available = await coreTablesAvailable();

// Real database round-trips can exceed the 5s default on a busy machine.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

describe.skipIf(!available)('wms-link service (integration)', async () => {
  const { and, eq, inArray } = await import('drizzle-orm');
  const { customerLinks, customers: coreCustomers } = await import('@kitstak/db/schema');
  const { db } = await import('@/server/db');
  const { createWorkspace } = await import('../workspaces');
  const { createBoard, getBoardPayload } = await import('../boards');
  const { createItem } = await import('../items');
  const { getCustomerLink, searchCoreCustomers, setCustomerLink } = await import('../wms-link');
  const { NotFoundError, ValidationError } = await import('@/server/http/errors');

  let fixture: Awaited<ReturnType<typeof createTestOrgs>>;
  let orgA: TestOrg;
  let orgB: TestOrg;
  let accountItemId: string;
  let dealItemId: string;
  let acmeId: string;
  let globexId: string;
  let foreignId: string;
  const customerIds: string[] = [];

  async function seedCustomer(orgId: string, code: string, name: string, status = 'Active') {
    const [row] = await db.insert(coreCustomers).values({ orgId, code, name, status }).returning();
    if (!row) throw new Error('customer insert failed');
    customerIds.push(row.id);
    return row.id;
  }

  async function itemOnBoard(ctx: Awaited<ReturnType<typeof ctxFor>>, templateId: string, name: string) {
    const workspace = await createWorkspace(ctx, { name: `WMS ${templateId}`, color: 'blue', kind: 'open' });
    const board = await createBoard(ctx, {
      workspaceId: workspace.id,
      name,
      templateId,
      privacy: 'main',
      withSampleData: false,
    });
    const payload = await getBoardPayload(ctx, board.id, { limit: 10 });
    const groupId = payload.groups[0]?.id;
    const item = await createItem(ctx, board.id, { name: `${name} item`, groupId });
    return item.id;
  }

  beforeAll(async () => {
    fixture = await createTestOrgs([
      { key: 'a', users: { owner: 'owner', rep: 'member' } },
      { key: 'b', users: { owner: 'owner' } },
    ]);
    orgA = fixture.orgs.a as TestOrg;
    orgB = fixture.orgs.b as TestOrg;
    const owner = await ctxFor(orgA, 'owner');
    accountItemId = await itemOnBoard(owner, 'crm-accounts', 'Accounts');
    dealItemId = await itemOnBoard(owner, 'crm-deals', 'Deals');
    acmeId = await seedCustomer(orgA.orgId, 'ACME', 'Acme Robotics');
    globexId = await seedCustomer(orgA.orgId, 'GLX-01', 'Globex Logistics', 'Inactive');
    foreignId = await seedCustomer(orgB.orgId, 'BORG', 'Acme Elsewhere');
  }, 60_000);

  afterAll(async () => {
    // Deleting the customers cascades crm.customer_links rows.
    if (customerIds.length) await db.delete(coreCustomers).where(inArray(coreCustomers.id, customerIds));
    await fixture?.cleanup();
  });

  it('searches core customers in the org by name and code', async () => {
    const rep = await ctxFor(orgA, 'rep');
    const all = await searchCoreCustomers(rep, {});
    expect(all.map((customer) => customer.code)).toEqual(['ACME', 'GLX-01']);

    const byName = await searchCoreCustomers(rep, { search: 'acme' });
    expect(byName.map((customer) => customer.id)).toEqual([acmeId]);

    const byCode = await searchCoreCustomers(rep, { search: 'glx' });
    expect(byCode.map((customer) => customer.id)).toEqual([globexId]);
    expect(byCode[0]?.status).toBe('Inactive');

    expect(await searchCoreCustomers(rep, { search: 'zzz-no-match' })).toEqual([]);

    // Another org never sees them.
    const other = await ctxFor(orgB, 'owner');
    expect((await searchCoreCustomers(other, {})).map((customer) => customer.id)).toEqual([foreignId]);
  });

  it('links, replaces and unlinks an account item', async () => {
    const rep = await ctxFor(orgA, 'rep');
    expect((await getCustomerLink(rep, accountItemId)).customer).toBeNull();

    const linked = await setCustomerLink(rep, accountItemId, { coreCustomerId: acmeId });
    expect(linked.customer?.code).toBe('ACME');
    expect((await getCustomerLink(rep, accountItemId)).customer?.id).toBe(acmeId);

    // Relinking replaces the existing row — one link per item.
    const replaced = await setCustomerLink(rep, accountItemId, { coreCustomerId: globexId });
    expect(replaced.customer?.id).toBe(globexId);
    const rows = await db
      .select()
      .from(customerLinks)
      .where(and(eq(customerLinks.itemId, accountItemId), eq(customerLinks.orgId, orgA.orgId)));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.coreCustomerId).toBe(globexId);

    const unlinked = await setCustomerLink(rep, accountItemId, { coreCustomerId: null });
    expect(unlinked.customer).toBeNull();
    expect((await getCustomerLink(rep, accountItemId)).customer).toBeNull();
  });

  it('is org-scoped: foreign customers and foreign items read as not found', async () => {
    const rep = await ctxFor(orgA, 'rep');
    await expect(setCustomerLink(rep, accountItemId, { coreCustomerId: foreignId })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const other = await ctxFor(orgB, 'owner');
    await expect(getCustomerLink(other, accountItemId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(setCustomerLink(other, accountItemId, { coreCustomerId: foreignId })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('only accounts board items can be linked', async () => {
    const rep = await ctxFor(orgA, 'rep');
    await expect(setCustomerLink(rep, dealItemId, { coreCustomerId: acmeId })).rejects.toBeInstanceOf(
      ValidationError,
    );
    // Unlink on a non-accounts item is still a no-op success (idempotent remove).
    expect((await setCustomerLink(rep, dealItemId, { coreCustomerId: null })).customer).toBeNull();
  });
});
