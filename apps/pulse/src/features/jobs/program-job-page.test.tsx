/**
 * The job page of a program job (docs/programs/PULSE_PROGRAMS_SPEC.md 5.3), with J-1040 holding
 * GLOVE:
 *  - `/jobs/J-1040` goes to `/programs/GLOVE` (a server side redirect in the page loader); the
 *    other tabs and `?view=job` stay on the job. A normal job never moves.
 *  - `/jobs/J-1040?view=job` shows the banner and "Open program", no Plan vs actual tab, the one
 *    line "Plans come from the GLOVE program in Projects." and no quote prompt, even with a typed
 *    quote and a stale "no plan" need on the job.
 *  - Its price reads "Varies by variant" from GLOVE price card v2, with "Open price card".
 *  - A normal job keeps its Plan vs actual tab and its "There is no quote or budget" prompt.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobProgramRefDTO } from '@/lib/program-types';
import type { JobDetailDTO, JobPlanDTO, SettingsDTO } from '@/lib/types';
import type { JobProgramPageDTO } from './program-job';

vi.mock('@/components/charts/charts.css', () => ({}));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

class Redirected extends Error {
  constructor(readonly to: string) {
    super(`NEXT_REDIRECT ${to}`);
  }
}
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => '/jobs/J-1040',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/features/shell/shell-context', () => ({
  useShell: () => ({
    seesMoney: true,
    can: () => true,
    user: { id: 'u1' },
    modules: { crm: false, wms: false, projects: true, pulse: true },
    appUrls: { portal: '', crm: '', wms: '', projects: 'https://projects.test', pulse: '' },
    integrations: { crm: false, wms: false, projects: true },
  }),
}));

const ok = <T,>(value: T) => ({ data: value, isError: false, isFetching: false, isLoading: false, isPending: false, error: null, refetch: () => undefined });
vi.mock('@/lib/hooks/use-data', () => ({
  useJob: () => ok(undefined),
  usePeople: () => ok([]),
  useJobProgram: () => ok(undefined),
  useProgramsToLink: () => ok([]),
  useProduction: () => ok([]),
  useJobDays: () => ok({ rows: [] }),
  useCosts: () => ok([]),
  useMaterialUsage: () => ok([]),
  useRevenue: () => ok([]),
  useVasEntries: () => ok([]),
}));
vi.mock('@/server/actions/jobs', () => ({}));
vi.mock('@/server/actions/views', () => ({ recordRecentJobAction: async () => undefined }));
vi.mock('@/server/actions/integrations', () => ({}));

// The page loader's reads.
const reads = vi.hoisted(() => ({ program: null as JobProgramRefDTO | null, job: null as unknown }));
vi.mock('@/server/page', () => ({
  pulsePage: async () => ({ ctx: { orgId: 'o1', userId: 'u1' }, context: { org: { name: 'Northwind' } }, access: { role: 'owner', seesMoney: true }, blocked: false, can: () => true }),
}));
vi.mock('@/server/domain', () => ({
  getJob: async () => reads.job,
  getSettings: async () => ({ timezone: 'America/Chicago', defaultTargetMarginBp: 3000 }),
  listLaborClasses: async () => [],
  listVasServices: async () => [],
  listJobTypes: async () => [],
  listSites: async () => [],
  todayInZone: () => '2026-11-25',
}));
vi.mock('./server/program-job', () => ({
  jobProgramRef: async () => reads.program,
  jobProgramPage: async (_ctx: unknown, program: JobProgramRefDTO) => ({ program, price: { kind: 'varies' } }),
}));

const { JobPage } = await import('./job-page');
const { JobFrame } = await import('./job-frame');
const { ProgramPricePanel } = await import('./job-program');

const GLOVE: JobProgramRefDTO = { programId: 'p-glove', key: 'GLOVE', name: 'Glove kitting', cardVersion: 2, deleted: false, path: '/programs/GLOVE', projectsPath: '/programs/GLOVE' };

const quote = { plan: 'quote', units: '2000.000', revenueCents: 8926020, laborCents: 3000000, materialCents: 1000000, otherCents: 0, sharedCents: 0, laborHours: '400.00', moneyHidden: false, lines: [] } as unknown as JobPlanDTO;

function jobFixture(patch: Partial<JobDetailDTO> = {}): JobDetailDTO {
  const stats = {
    unitsGood: '560.000', unitsScrap: '0.000', unitsRework: '0.000', hours: '40.00', overtimeHours: '0.00', setupHours: '0.00', paceHours: '40.00', evidenceDays: 3,
    revenueCents: 2997040, baseRevenueCents: 2997040, vasRevenueCents: 0, otherRevenueCents: 0, billedCents: 0, notBilledYetCents: 2997040,
    laborCents: 1000000, materialCents: 200000, scrapCents: 0, otherCents: 0, sharedCents: 0, costCents: 1200000, profitCents: 1797040,
    marginBp: 5996, marginBeforeSharedBp: 5996, uph: '14.000', standardUph: null, productivityBp: null, pctCompleteBp: 7000, targetMarginBp: 3000,
    mode: 'projected', costAtFinishCents: null, revenueAtFinishCents: null, projectedProfitCents: 2000000, projectedMarginBp: 5000, projectedLaborHours: null,
    projectedFinishDate: null, paceUph: null, paceWeightBp: null, confidence: null, riskStatus: 'heads_up',
    riskReasons: [
      { rule: 'X1', params: {}, impactCents: null, nextStep: 'review_price', nextStepLabel: 'Check the price', text: 'Something to look at.' },
      { rule: 'D4', params: {}, impactCents: null, nextStep: 'add_plan', nextStepLabel: 'Add a quote or a budget', text: 'There is no plan.' },
    ],
    headline: 'Something to look at.', needs: { noPlan: true }, laborMissing: false, firstEntryDate: '2026-11-02', lastEntryDate: '2026-11-24', entryCount: 3, computedAt: null, moneyHidden: false,
  };
  return {
    id: 'j1040', number: 'J-1040', name: 'Gripwell glove kitting program', clientId: 'c1', clientName: 'Gripwell Safety Supply', clientCode: 'GRIP', jobTypeId: 't1', jobTypeName: 'Kitting', siteId: 's1', siteName: 'Main',
    kind: 'ongoing', status: 'active', pricingModel: 'per_unit', unitLabel: 'kits', plannedUnits: '2000.000', unitPrice: '3.0000', fixedPriceCents: null, billRateCents: null,
    materialMethod: 'standard', materialCostPerUnit: null, partsOwner: null, defaultLaborClassId: null, usualCrew: [], standardUph: null, targetMarginBp: null, startDate: null, dueDate: null, completedDate: null,
    poNumber: null, ownerId: null, description: null, kitSku: null, kitName: null, wmsShortage: false, pinnedNote: null, archivedAt: null, deletedAt: null, source: 'manual', isSample: false, version: 1,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', moneyHidden: false,
    stats, planLaborHours: '400.00', program: { kind: 'program', key: 'GLOVE', name: 'Glove kitting', programId: 'p-glove', buildCount: 0, path: '/programs/GLOVE' },
    prices: [], quote, budget: null, links: [], owner: null,
    ...patch,
  } as unknown as JobDetailDTO;
}

const settings = { timezone: 'America/Chicago', defaultTargetMarginBp: 3000 } as unknown as SettingsDTO;

function wrap(node: React.ReactNode): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>{node}</TooltipProvider>
    </QueryClientProvider>,
  );
}

function render(job: JobDetailDTO, tab: 'overview' | 'plan', program: JobProgramPageDTO | null): string {
  return wrap(<JobFrame initialJob={job} tab={tab} today="2026-11-25" settings={settings} laborClasses={[]} services={[]} jobTypes={[]} program={program} />);
}

const params = (ref: string) => Promise.resolve({ ref });
const search = (query: Record<string, string>) => Promise.resolve(query);

describe('the job page loader of a program job', () => {
  beforeEach(() => {
    reads.program = GLOVE;
    reads.job = jobFixture();
  });

  it('sends /jobs/J-1040 to /programs/GLOVE', async () => {
    await expect(JobPage({ params: params('J-1040'), tab: 'overview', searchParams: search({}) })).rejects.toMatchObject({ to: '/programs/GLOVE' });
  });

  it('keeps /jobs/J-1040?view=job on the job, with the program for the banner', async () => {
    const element = (await JobPage({ params: params('J-1040'), tab: 'overview', searchParams: search({ view: 'job' }) })) as React.ReactElement<{ program: JobProgramPageDTO | null }>;
    expect(element.props.program).toEqual({ program: GLOVE, price: { kind: 'varies' } });
  });

  it('keeps the other tabs of a program job on the job (the work log is where hours go)', async () => {
    const element = (await JobPage({ params: params('J-1040'), tab: 'work' })) as React.ReactElement<{ program: JobProgramPageDTO | null }>;
    expect(element.props.program?.program.key).toBe('GLOVE');
  });

  it('never moves a normal job, or a job only fed by billed builds', async () => {
    reads.program = null;
    reads.job = jobFixture({ program: { kind: 'builds', key: 'GLOVE', name: null, programId: 'p-glove', buildCount: 2, path: '/programs/GLOVE' } });
    const element = (await JobPage({ params: params('J-1040'), tab: 'overview', searchParams: search({}) })) as React.ReactElement<{ program: JobProgramPageDTO | null }>;
    expect(element.props.program).toBeNull();
  });
});

describe('the job page of a program job (?view=job)', () => {
  const program: JobProgramPageDTO = { program: GLOVE, price: { kind: 'varies' } };

  it('shows the banner with Open program, and no quote prompt anywhere on the overview', () => {
    const html = render(jobFixture(), 'overview', program);
    expect(html).toContain('This job holds the labor and costs of the GLOVE program. See the program for its plan and profit.');
    expect(html).toMatch(/href="\/programs\/GLOVE"[^>]*data-testid="program-job-open"[^>]*>.*Open program/);
    expect(html).toContain('Plans come from the GLOVE program in Projects.');
    expect(html).toContain('The quote typed on this job is kept but not used.');
    expect(html).not.toContain('There is no quote or budget');
    expect(html).not.toContain('Add a quote');
    expect(html).not.toContain('next-step-add_plan');
    expect(html).not.toContain('Add a plan to see what it should cost');
    // The typed 2,000 planned kits are not the program's plan.
    expect(html).not.toContain('of 2,000');
  });

  it('has no Plan vs actual tab, and its Overview tab keeps ?view=job; breadcrumbs go through Programs', () => {
    const html = render(jobFixture(), 'overview', program);
    expect(html).not.toContain('Plan vs actual');
    expect(html).toContain('href="/jobs/J-1040?view=job"');
    expect(html).toContain('href="/jobs/J-1040/work"');
    expect(html).toContain('href="/programs"');
  });

  it('answers the plan tab with the one line, not the quote editor', () => {
    const html = render(jobFixture(), 'plan', program);
    expect(html).toContain('data-testid="program-plan-note"');
    expect(html).toContain('Plans come from the GLOVE program in Projects.');
    expect(html).not.toContain('No plan yet');
    expect(html).not.toContain('Quote vs actual');
  });

  it('leaves out the kept line when nothing was typed', () => {
    const html = render(jobFixture({ quote: null }), 'plan', program);
    expect(html).toContain('Plans come from the GLOVE program in Projects.');
    expect(html).not.toContain('kept but not used');
  });

  it('shows the card price: Varies by variant, from GLOVE price card v2, with Open price card', () => {
    const html = wrap(<ProgramPricePanel job={jobFixture()} program={program} />);
    expect(html).toContain('Varies by variant');
    expect(html).toContain('Prices come from GLOVE price card v2 in Projects.');
    expect(html).toContain('href="https://projects.test/programs/GLOVE/price-card"');
    expect(html).toContain('Open price card');
    expect(html).not.toContain('$3.00');
    expect(wrap(<ProgramPricePanel job={jobFixture()} program={{ program: GLOVE, price: { kind: 'single', unitPrice: '1.9500' } }} />)).toContain('$1.95');
  });
});

describe('a normal job keeps its plan', () => {
  it('keeps the Plan vs actual tab and the no quote prompt', () => {
    const html = render(jobFixture({ program: null, quote: null }), 'overview', null);
    expect(html).toContain('Plan vs actual');
    expect(html).toContain('There is no quote or budget');
    expect(html).not.toContain('program-job-banner');
    expect(html).toContain('href="/jobs/J-1040"');
  });
});
