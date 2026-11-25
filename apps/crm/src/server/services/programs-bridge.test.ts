/**
 * The CRM side of KitStak Programs (docs/programs/SPEC.md 6.2, 6.5): with the entitlement gate
 * on (ENTITLEMENTS_DEV_ALLOW_ALL=0) and no Projects grant the Programs tab reads
 * `not_licensed` (an add link only for owners and admins, so the tab stays hidden for everyone
 * else); with Projects licensed it lists programs and starts new ones from the deal.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hasModule: vi.fn(),
  requireItem: vi.fn(),
  listLinkedPrograms: vi.fn(),
  dealFacts: vi.fn(),
}));

vi.mock('@/server/db', () => ({ db: {} }));
vi.mock('@/server/env', () => ({ env: { NEXT_PUBLIC_PROJECTS_URL: 'http://localhost:3400' } }));
vi.mock('@kitstak/entitlements', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kitstak/entitlements')>()),
  hasModule: mocks.hasModule,
}));
vi.mock('./access', () => ({ requireItem: mocks.requireItem }));
vi.mock('@kitstak/db/crm-deal-facts', () => ({ dealFacts: mocks.dealFacts }));
vi.mock('@kitstak/pm-bridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kitstak/pm-bridge')>()),
  listLinkedPrograms: mocks.listLinkedPrograms,
}));

const ORG = '00000000-0000-4000-8000-0000000000a1';
const USER = '00000000-0000-4000-8000-0000000000b1';
const DEAL = '00000000-0000-4000-8000-0000000000c1';

function ctx(roles: readonly string[] = ['member']) {
  return { db: {} as never, orgId: ORG, userId: USER, roles: roles as never };
}

function dealItem(overrides: Record<string, unknown> = {}) {
  return {
    item: { id: DEAL, name: 'Gripwell Safety Supply · Glove kitting program', parentItemId: null, deletedAt: null, archivedAt: null, ...overrides },
    board: { id: 'b1', kind: 'deals' },
  };
}

const PROGRAM = {
  id: 'p1',
  key: 'GLOVE',
  name: 'Glove kitting',
  status: 'active',
  statusLabel: 'Running',
  color: 'blue',
  icon: 'repeat',
  unit: { singular: 'kit', plural: 'kits' },
  customerName: 'Gripwell Safety Supply',
  moneyHidden: false,
  month: { month: '2026-11', units: '14172.000', revenueCents: '2997040', forecastCents: '3370840', forecastMethod: 'planned', targetBp: 10534 },
  today: { date: '2026-11-25', builds: 8, done: 5 },
  cardSummary: '$1.95 per kit · $1,500 monthly · $30,000 minimum',
  deal: { valueCents: '38640000', termMonths: 12, onTrackForCents: '39024400' },
  url: 'http://localhost:3400/programs/GLOVE',
  linkVia: 'record_link',
};

describe('getItemPrograms', () => {
  beforeEach(() => {
    vi.stubEnv('ENTITLEMENTS_DEV_ALLOW_ALL', '0');
    mocks.requireItem.mockResolvedValue(dealItem());
    mocks.dealFacts.mockResolvedValue({ valueCents: BigInt(38640000), currency: 'USD', won: true, accountName: 'Gripwell Safety Supply', rates: { termMonths: 12 } });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('hides the tab when Projects is not licensed, and offers the add link only to admins', async () => {
    mocks.hasModule.mockImplementation(async (_db: unknown, _org: string, module: string) => module !== 'projects');
    const { getItemPrograms } = await import('./programs-bridge');
    const member = await getItemPrograms(ctx(['member']), DEAL);
    expect(member).toMatchObject({ available: false, reason: 'not_licensed', addProjectsUrl: null, programs: [] });
    const admin = await getItemPrograms(ctx(['admin']), DEAL);
    expect(admin.reason).toBe('not_licensed');
    expect(admin.addProjectsUrl).toMatch(/\/billing$/);
    expect(mocks.listLinkedPrograms).not.toHaveBeenCalled();
  });

  it('lists programs and the deal when Projects is licensed', async () => {
    mocks.hasModule.mockResolvedValue(true);
    mocks.listLinkedPrograms.mockResolvedValue({ available: true, moneyHidden: false, programs: [PROGRAM] });
    const { getItemPrograms } = await import('./programs-bridge');
    const result = await getItemPrograms(ctx(), DEAL);
    expect(result.available).toBe(true);
    expect(result.kind).toBe('deal');
    expect(result.programs).toHaveLength(1);
    expect(result.deal).toEqual({ valueCents: '38640000', currency: 'USD', won: true, accountName: 'Gripwell Safety Supply', termMonths: 12 });
    expect(result.createProgramUrl).toContain(`/programs/new?crmItem=${DEAL}`);
    const targets = mocks.listLinkedPrograms.mock.calls[0]?.[2];
    expect(targets).toEqual([
      { type: 'crm_item', id: DEAL },
      { type: 'crm_account', id: DEAL },
    ]);
  });

  it('never offers to start a program from an archived deal, and has no tab on other boards or subitems', async () => {
    mocks.hasModule.mockResolvedValue(true);
    mocks.listLinkedPrograms.mockResolvedValue({ available: true, moneyHidden: false, programs: [] });
    const { getItemPrograms } = await import('./programs-bridge');
    mocks.requireItem.mockResolvedValue(dealItem({ archivedAt: new Date() }));
    expect((await getItemPrograms(ctx(), DEAL)).createProgramUrl).toBeNull();
    mocks.requireItem.mockResolvedValue({ item: { id: DEAL, name: 'Task', parentItemId: null }, board: { id: 'b2', kind: 'custom' } });
    expect((await getItemPrograms(ctx(), DEAL)).reason).toBe('not_applicable');
    mocks.requireItem.mockResolvedValue(dealItem({ parentItemId: 'parent' }));
    expect((await getItemPrograms(ctx(), DEAL)).reason).toBe('not_applicable');
  });

  it('reads not installed when the program tables are missing', async () => {
    mocks.hasModule.mockResolvedValue(true);
    mocks.listLinkedPrograms.mockResolvedValue({ available: false, reason: 'not_installed' });
    const { getItemPrograms } = await import('./programs-bridge');
    expect(await getItemPrograms(ctx(), DEAL)).toMatchObject({ available: false, reason: 'not_installed' });
  });
});
