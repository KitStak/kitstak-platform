/** M14 round 2: printout system defaults, audit repeat grouping, user-info step validation. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { auditLog } from '@/server/db/schema';
import { EMPTY_GRID_QUERY } from '@/server/query/grid-query';
import { PRINT_TYPES } from '@/server/print/catalog';
import {
  deletePrintouts,
  ensureDefaultPrintouts,
  listPrintouts,
  printoutTypes,
} from '@/server/repositories/printouts';
import { listAuditLog } from '@/server/repositories/audit';
import { unmetPasswordRules, userInfoSchemaFor } from '@/lib/grid-defs/admin/users';
import type { AuthContext } from '@/server/auth/context';
import { createWorld, type World } from '../foundation/domain/fixtures';

describe('printout system defaults', () => {
  let w: World;
  beforeEach(async () => {
    w = await createWorld();
  });
  afterEach(() => w.close());

  it('every print type has exactly one locked default, idempotently', async () => {
    await ensureDefaultPrintouts(w.db);
    expect(await ensureDefaultPrintouts(w.db)).toBe(0);
    const types = await printoutTypes(w.db);
    expect(types).toHaveLength(PRINT_TYPES.length);
    for (const t of types) expect(t.count).toBeGreaterThan(0);
    const rows = (await listPrintouts(w.db, EMPTY_GRID_QUERY, 'packing-list')).rows;
    expect(rows.filter((r) => r.isDefault)).toHaveLength(1);
  });

  it("the default can't be deleted", async () => {
    const def = (await listPrintouts(w.db, EMPTY_GRID_QUERY, 'packing-list')).rows.find((r) => r.isDefault)!;
    const scope = { warehouseIds: [w.warehouseId], clientIds: 'all' as const };
    const auth = {
      scope,
      viewScope: scope,
      permissions: new Set<string>(),
      restrictions: [],
      user: { id: w.userId },
      context: { warehouseId: null, clientId: null },
    } as unknown as AuthContext;
    const res = await deletePrintouts(w.db, auth, { userId: w.userId, source: 'Web' }, [def.id]);
    expect(res.succeeded).toEqual([]);
    expect(res.failed[0]?.message).toMatch(/default template/);
  });
});

describe('audit repeat grouping', () => {
  let w: World;
  beforeEach(async () => {
    w = await createWorld();
  });
  afterEach(() => w.close());

  it('collapses identical events within a day into one row with a count', async () => {
    const base = {
      action: 'security.csrf_rejected',
      entity: 'request',
      entityId: 'POST /api/billing/calculate',
      detail: '{"reason":"missing_header"}',
      ip: '127.0.0.1',
      outcome: 'failure' as const,
    };
    await w.db
      .insert(auditLog)
      .values([0, 1, 2, 3].map((i) => ({ ...base, at: `2026-11-09T10:0${i}:00.000Z` })));
    await w.db.insert(auditLog).values({ ...base, at: '2026-11-10T11:30:00.000Z' });
    const raw = (await listAuditLog(w.db, EMPTY_GRID_QUERY)).rows.filter((r) => r.action === base.action);
    expect(raw).toHaveLength(5);
    const grouped = (await listAuditLog(w.db, EMPTY_GRID_QUERY, { groupRepeats: true })).rows.filter(
      (r) => r.action === base.action,
    );
    expect(grouped.map((r) => r.repeatCount).sort()).toEqual([1, 4]);
  });
});

describe('user info step validation', () => {
  const policy = { minLength: 10, requireUpper: true, requireNumber: true, requireSymbol: true };
  const base = {
    firstName: '',
    lastName: '',
    email: '',
    userType: 'Operation',
    password: '',
    confirmPassword: '',
    sendWelcomeEmail: false,
    isActive: true,
  };
  const paths = (v: Record<string, unknown>, isEdit = false) =>
    (userInfoSchemaFor(isEdit, policy).safeParse(v).error?.issues ?? []).map(
      (i) => `${String(i.path[0])}: ${i.message}`,
    );

  it('reports every required field, including confirm password, on the first submit', () => {
    const issues = paths(base);
    expect(issues.some((i) => i.startsWith('firstName'))).toBe(true);
    expect(issues).toContain('password: Password is required');
    expect(issues).toContain('confirmPassword: Confirm password is required');
  });
  it('explains a weak password inline and flags mismatches', () => {
    const issues = paths({
      ...base,
      firstName: 'A',
      lastName: 'B',
      email: 'a@b.co',
      password: 'abc',
      confirmPassword: 'abd',
    });
    expect(issues.find((i) => i.startsWith('password'))).toMatch(/at least 10 characters/);
    expect(issues).toContain('confirmPassword: Passwords do not match');
    expect(unmetPasswordRules('Abcdefgh1!', policy)).toEqual([]);
  });
  it('edit mode allows blank passwords', () => {
    expect(paths({ ...base, firstName: 'A', lastName: 'B', email: 'a@b.co' }, true)).toEqual([]);
  });
});
