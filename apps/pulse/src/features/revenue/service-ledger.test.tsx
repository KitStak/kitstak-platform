/**
 * The extra services ledger, rendered to static markup: an entry pulled from the warehouse says
 * where it came from and links back to its record, its date and count cannot be typed over, and
 * its price and labor hours still can. With the warehouse off the plan the words stay and the
 * link goes.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { VasEntryDTO, VasServiceDTO } from '@/lib/types';

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: async () => undefined, setQueryData: () => undefined }), useQuery: () => ({ data: undefined, isLoading: false, isError: false }) }));
vi.mock('@/features/shell/shell-context', () => ({ useShell: () => ({ seesMoney: true, can: () => true, user: { id: 'u1' }, integrations: { wms: true } }) }));
vi.mock('@/features/costs/targets', () => ({ readTarget: () => null, useEntryTargets: () => ({ loading: false, options: [], jobNumber: () => null, jobLabel: () => null, clientLabel: () => 'NovaForge Electronics' }) }));
vi.mock('@/server/actions/entries', () => ({ saveVasEntryAction: async () => ({ ok: false }), deleteVasEntryAction: async () => ({ ok: false }), restoreVasEntryAction: async () => ({ ok: false }) }));
vi.mock('@/server/actions/money-ops', () => ({ saveVasEntriesBulkAction: async () => ({ ok: false }) }));

const entry = (id: string, patch: Partial<VasEntryDTO>): VasEntryDTO => ({
  id,
  siteId: 's1',
  source: 'manual',
  sourceRef: null,
  sourceUrl: null,
  isSample: false,
  version: 1,
  note: null,
  createdBy: 'u1',
  createdAt: '2026-11-18T00:00:00.000Z',
  updatedAt: '2026-11-18T00:00:00.000Z',
  deletedAt: null,
  locked: false,
  moneyHidden: false,
  vasServiceId: 'svc1',
  clientId: 'c1',
  jobId: null,
  workDate: '2026-10-12',
  quantity: '3.000',
  unitPrice: '65.0000',
  amountCents: 19500,
  noPrice: false,
  laborClassId: null,
  headcount: null,
  hours: '0.00',
  overtimeHours: '0.00',
  materialCents: 0,
  laborCostCents: 0,
  sharedCents: 0,
  needsRate: false,
  ...patch,
});

const rows: VasEntryDTO[] = [
  entry('typed', {}),
  entry('pulled', { source: 'wms', sourceRef: 'wms:vas:1', sourceUrl: 'http://wms.example/billing/vas' }),
  entry('offplan', { source: 'wms', sourceRef: 'wms:vas:2', sourceUrl: null, unitPrice: null, amountCents: null, noPrice: true }),
];
const service = { id: 'svc1', code: 'PROG', name: 'Programming (hours)', unitLabel: 'hours', billing: 'per_unit', defaultPrice: null, defaultCostPerUnit: null, standardUph: null, defaultLaborClassId: null, wmsVasTypeId: 't1', color: null, active: true, version: 1, moneyHidden: false } as VasServiceDTO;

vi.mock('@/lib/hooks/use-data', () => ({
  useVasEntries: () => ({ data: rows, isLoading: false, isError: false, error: null, refetch: () => undefined }),
  useVasServices: () => ({ data: [service], isLoading: false, isSuccess: true }),
}));

const { ServiceLedger } = await import('./service-ledger');
const { TooltipProvider } = await import('@/components/ui');

describe('extra services ledger, warehouse entries', () => {
  const html = renderToStaticMarkup(
    <TooltipProvider>
      <ServiceLedger clientId="c1" today="2026-11-18" />
    </TooltipProvider>,
  );

  it('links a pulled entry back to the warehouse', () => {
    expect(html).toContain('From the warehouse');
    expect(html).toMatch(/<a[^>]+href="http:\/\/wms\.example\/billing\/vas"[^>]*data-testid="service-source-pulled"/);
  });

  it('keeps the words and drops the link when there is no address', () => {
    expect(html.match(/From the warehouse/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).not.toContain('service-source-offplan');
    expect(html.match(/href="http:\/\/wms\.example/g)).toHaveLength(html.match(/service-source-pulled/g)?.length ?? 0);
  });

  it('lets a person type over a typed entry, and only the price and hours of a pulled one', () => {
    for (const column of ['workDate', 'quantity', 'hours', 'unitPrice']) expect(html, `typed ${column}`).toContain(`service-ledger-typed-${column}`);
    for (const column of ['workDate', 'quantity', 'service']) expect(html, `pulled ${column}`).not.toContain(`service-ledger-pulled-${column}`);
    for (const column of ['hours', 'unitPrice']) expect(html, `pulled ${column}`).toContain(`service-ledger-pulled-${column}`);
  });

  it('flags the pulled entry that has no price yet', () => {
    expect(html).toContain('No price yet');
    expect(html).toContain('1 with no price');
  });
});
