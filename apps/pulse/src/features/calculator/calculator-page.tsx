import { Page } from '@/components/layout/page';
import { PageBlocked } from '@/features/access/page-blocked';
import { routes } from '@/lib/routes';
import { getCalculatorSetup, getQuoteScenario, listQuoteScenarios, quoteFromJob, type QuoteFromJobDTO, type QuoteScenarioDTO } from '@/server/domain';
import { isDomainError } from '@/server/errors';
import { pulsePage } from '@/server/page';
import { CalculatorLoadError, CalculatorView } from './calculator-view';

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (value: string | string[] | undefined): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** Calculator: price a new job for a target margin, or open a real job in what if mode (`?job=`), or a saved scenario (`?scenario=`). */
export async function CalculatorPage({ searchParams }: { readonly searchParams?: Search }) {
  const params = (await searchParams) ?? {};
  const jobRef = one(params.job);
  const scenarioId = one(params.scenario);
  const page = await pulsePage(routes.calculator({ job: jobRef ?? undefined, scenario: scenarioId ?? undefined }), 'calculator');
  if (page.blocked || !page.access.seesMoney) return <PageBlocked title="Calculator" role={page.access.role} />;
  const [setup, scenarios] = await Promise.all([getCalculatorSetup(page.ctx), listQuoteScenarios(page.ctx)]);
  let fromJob: QuoteFromJobDTO | null = null;
  let scenario: QuoteScenarioDTO | null = null;
  let problem: string | null = null;
  try {
    if (scenarioId) scenario = await getQuoteScenario(page.ctx, scenarioId);
    else if (jobRef && setup.hasRate) fromJob = await quoteFromJob(page.ctx, jobRef);
  } catch (error) {
    problem = isDomainError(error) ? (scenarioId ? 'That scenario is not here any more. It may have been deleted.' : `We could not find the job "${jobRef}". Check the job number and try again.`) : 'Something went wrong on our side. Please try again.';
  }
  return (
    <Page title="Calculator" subtitle="Price a new job, or test a what if, before you say yes.">
      {problem ? <CalculatorLoadError message={problem} /> : <CalculatorView initialSetup={setup} initialScenarios={scenarios} initialFromJob={fromJob} initialScenario={scenario} />}
    </Page>
  );
}
