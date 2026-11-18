/**
 * Home for two readers, rendered to static markup: someone who sees money, and someone who does
 * not. The second must get units, hours and pace, and not one money figure or money tile.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompanyBridgeDTO, JobListItemDTO, ProfitResponse, ProfitRowDTO, SummaryDTO } from '@/lib/types';

vi.mock('@/components/charts/charts.css', () => ({}));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }));

const shell = { seesMoney: true };
vi.mock('@/features/shell/shell-context', () => ({ useShell: () => ({ seesMoney: shell.seesMoney, can: () => true, user: { id: 'u1' } }) }));

const row = (key: string, label: string, money: boolean, patch: Partial<ProfitRowDTO> = {}): ProfitRowDTO => {
  const m = <T,>(value: T): T | null => (money ? value : null);
  return { key, label, sublabel: null, revenueCents: m(4821000), baseRevenueCents: m(4821000), vasRevenueCents: m(0), otherRevenueCents: m(0), laborCents: m(2000000), materialCents: m(900000), otherCents: m(100000), sharedCents: m(326500), costCents: m(3326500), profitCents: m(1494500), marginBp: m(3100), marginBeforeSharedBp: m(3777), laborPctBp: m(4149), billedCents: m(1000000), unitsGood: '12480.000', unitsScrap: '10.000', hours: '312.00', uph: '40.000', costPerUnitCents: m(267), profitPerUnitCents: m(120), jobCount: 3, prior: null, trend: null, laborMissing: false, riskStatus: null, ...patch } as ProfitRowDTO;
};

function fixtures(money: boolean) {
  const m = <T,>(value: T): T | null => (money ? value : null);
  const total = row('total', 'Total', money);
  const trend: ProfitResponse = { by: 'day', from: '2026-11-01', to: '2026-11-17', rows: [row('2026-11-16', '', money), row('2026-11-17', '', money)], total, moneyHidden: !money };
  const bridge: CompanyBridgeDTO = { from: '2026-11-01', to: '2026-11-17', workProfitCents: m(1494500), sharedGapCents: m(115000), missingCostCents: m(236000), companyCostCents: m(0), overheadAbsorbedCents: m(0), overheadGapCents: null, companyProfitCents: m(1143500), indirectCents: m(0), sharedAppliedCents: m(0), directHours: '312.00', indirectHours: '20.00', paidHours: '340.00', missingHours: '8.00', utilizationBp: 9176, paidCents: null, grossPayCents: m(0), payrollGapCents: null, overLoggedDays: 0, hasCompanyCosts: false, moneyHidden: !money };
  const summary: SummaryDTO = { from: '2026-11-01', to: '2026-11-17', openJobs: 9, atRisk: 2, losing: 1, headsUp: 1, onTrack: 5, noData: 0, total, prior: null, bridge, entryProgress: { activeJobs: 9, loggedToday: 7, date: '2026-11-17', daysReviewedThisWeek: 1, workDaysThisWeek: 1 }, notBilledYetCents: m(2500000), openAlerts: 0, thingsToFix: { needsRate: 2, noPrice: 1, unitsNoHours: 3, serviceNoPrice: 0 }, moneyHidden: !money };
  const job = { id: 'j1', number: 'J-1026', name: 'Chew toy 3 pack', clientName: 'Orchard Pet Supply', stats: { riskStatus: 'losing', headline: money ? 'At this pace the job ends in the red.' : 'The crew is running behind the target pace.', projectedProfitCents: m(-463200), confidence: 'solid' } } as unknown as JobListItemDTO;
  const byClient: ProfitResponse = { ...trend, by: 'client', rows: [row('c1', 'Lumen Skincare', money), row('c2', 'Orchard Pet Supply', money, { profitCents: m(-212400) })] };
  return { trend, summary, job, byClient };
}

let data = fixtures(true);
const ok = <T,>(value: T) => ({ data: value, isError: false, isFetching: false, isLoading: false, error: null, refetch: () => undefined });
vi.mock('@/lib/hooks/use-data', () => ({
  useSummary: () => ok(data.summary),
  useProfit: (by: string) => ok(by === 'client' || by === 'type' ? data.byClient : data.trend),
  useJobsNeedingAttention: () => ok([data.job]),
  useAlerts: () => ok([]),
  useExplain: () => ({ data: undefined, isError: false }),
}));

const { HomeView } = await import('./home-view');

const render = (): string => renderToStaticMarkup(<HomeView today="2026-11-17" weekStart={1} targetMarginBp={3000} initialRange={{ from: '2026-11-01', to: '2026-11-17' }} />);

describe('Home', () => {
  beforeEach(() => {
    shell.seesMoney = true;
    data = fixtures(true);
  });

  it('gives a money reader the two line answer, the money tiles and the bridge', () => {
    const html = render();
    expect(html).toContain('Your jobs made');
    expect(html).toContain('$14,945');
    expect(html).toContain('31%');
    expect(html).toContain('After time not on a job and overhead, the company made');
    expect(html).toContain('$11,435');
    expect(html).toContain('3 jobs need you.');
    expect(html).toContain('data-testid="home-tiles"');
    for (const label of ['Revenue', 'Cost', 'Profit on jobs', 'Margin after all costs', 'Labor as % of revenue', 'Units per person per hour', 'Not billed yet']) expect(html, label).toContain(label);
    expect(html).toContain('7 of 9 active jobs logged today');
    expect(html).toContain('J-1026');
    expect(html).toContain('-$4,632');
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('undefined');
  });

  it('gives a reader without money units, hours and pace, and no money anywhere', () => {
    shell.seesMoney = false;
    data = fixtures(false);
    const html = render();
    expect(html).toContain('Your crews finished');
    expect(html).toContain('12,480');
    expect(html).toContain('units per person per hour');
    expect(html).toContain('data-testid="home-tiles-floor"');
    for (const label of ['Units finished', 'Labor hours', 'Share of paid time spent on jobs', 'Units and pace']) expect(html, label).toContain(label);
    expect(html).not.toContain('data-testid="home-tiles"');
    for (const label of ['Revenue', 'Profit on jobs', 'Not billed yet', 'Where the cost went', 'Your jobs made']) expect(html, label).not.toContain(label);
    // No dollar amount anywhere on the page.
    expect(html).not.toMatch(/\$\s?\d/);
    // Things to fix that are about money (prices, rates) are left out; missing hours stay.
    expect(html).toContain('days have units and no hours');
    expect(html).not.toContain('no labor rate');
    expect(html).not.toContain('no price');
    expect(html).toContain('The crew is running behind the target pace.');
    expect(html).toContain('3 jobs need you.');
  });

  it('shows the first run checklist when there is nothing yet', () => {
    const empty = fixtures(true);
    const zero = row('total', 'Total', true, { revenueCents: 0, costCents: 0, profitCents: 0, unitsGood: '0.000', hours: '0.00', uph: null, marginBp: null });
    data = { ...empty, trend: { ...empty.trend, rows: [], total: zero }, summary: { ...empty.summary, openJobs: 0, losing: 0, atRisk: 0, total: zero } };
    const html = render();
    expect(html).toContain('data-testid="home-first-run"');
    expect(html).toContain('Five steps to your first profit number');
    expect(html).toContain('Add your first job');
  });
});
