import { FileSpreadsheet, PackagePlus } from 'lucide-react';
import { Page, Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { Teach } from '@/components/pulse/teach';
import { PageBlocked } from '@/features/access/page-blocked';
import { shiftDate } from '@/features/jobs/job-math';
import { routes } from '@/lib/routes';
import { targetMarginBp } from '@/lib/profit';
import {
  findClientByRef,
  getProfit,
  getSettings,
  listClients,
  listJobTypes,
  listJobs,
  listLaborClasses,
  listOrgPeople,
  listSites,
  listVasServices,
  programForNewJob,
  todayInZone,
} from '@/server/domain';
import { pulsePage } from '@/server/page';
import { NewJobWizard } from './new-job-wizard';
import { readCents } from './new-job-math';
import { listJobSources } from './server/job-sources';

type Query = Record<string, string | string[] | undefined>;

function first(query: Query, key: string, max = 200): string {
  const value = query[key];
  return ((Array.isArray(value) ? value[0] : value) ?? '').trim().slice(0, max);
}

async function soft<T>(read: Promise<T>, fallback: T): Promise<T> {
  try {
    return await read;
  } catch {
    return fallback;
  }
}

/**
 * New job: basics, price and plan, review. Prefills from `?crmDeal=`, `?wmsWorkOrder=`,
 * `?project=`, `?client=`, `?coreCustomerId=`, `?crmAccountItemId=`, `?name=` and `?value=`, and
 * from a KitStak program (`?program=&name=&clientHint=&unitLabel=`): an ongoing per unit job that
 * links the program on save.
 */
export async function NewJobPage({ searchParams }: { readonly searchParams?: Promise<Query> }) {
  const query = (await searchParams) ?? {};
  const page = await pulsePage(routes.newJob(), 'jobs');
  if (page.blocked) return <PageBlocked title="New job" role={page.access.role} />;
  const breadcrumbs = [{ label: 'Jobs', href: routes.jobs() }, { label: 'New job' }];
  if (!page.can('job:manage')) {
    return (
      <Page title="New job" breadcrumbs={breadcrumbs} width="narrow">
        <Panel>
          <Teach
            icon={PackagePlus}
            title="Your role cannot add jobs"
            why="Adding a job sets its price and plan, so it needs a manager. Ask a manager or admin of your workspace to add it, then you can log work against it."
            actions={<ButtonLink href={routes.jobs()}>Back to Jobs</ButtonLink>}
          />
        </Panel>
      </Page>
    );
  }
  const { ctx } = page;
  const [settings, clients, jobTypes, sites, laborClasses, services, people, recent, sources] =
    await Promise.all([
      getSettings(ctx),
      soft(listClients(ctx, {}), []),
      soft(listJobTypes(ctx), []),
      soft(listSites(ctx), []),
      soft(listLaborClasses(ctx), []),
      soft(listVasServices(ctx), []),
      soft(listOrgPeople(ctx), []),
      soft(listJobs(ctx, { tab: 'all', limit: 40 }), []),
      listJobSources(ctx),
    ]);
  const site = sites.find((item) => item.isDefault) ?? sites[0];
  const today = site?.today ?? todayInZone(settings.timezone);
  // The same 90 day window the server uses to fill a plan's time not on a job.
  const recentProfit = page.access.seesMoney
    ? await soft(getProfit(ctx, 'month', { from: shiftDate(today, -89), to: today }), null)
    : null;

  // Opened from a program (`?program=`): the program's customer picks the client when Pulse has it.
  const programId = first(query, 'program', 64);
  const program = programId ? await soft(programForNewJob(ctx, programId), null) : null;
  const hint = first(query, 'clientHint', 64) || program?.coreCustomerId || '';
  const clientRef = {
    pulseClientId: first(query, 'client') || null,
    coreCustomerId: first(query, 'coreCustomerId') || (hint && !first(query, 'crmAccountItemId') ? hint : null),
    crmAccountItemId: first(query, 'crmAccountItemId') || null,
  };
  let prefillClient =
    clientRef.pulseClientId || clientRef.coreCustomerId || clientRef.crmAccountItemId
      ? await soft(findClientByRef(ctx, clientRef), null)
      : null;
  if (!prefillClient && hint) prefillClient = await soft(findClientByRef(ctx, { pulseClientId: null, coreCustomerId: null, crmAccountItemId: hint }), null);
  const valueCents = readCents(first(query, 'value', 20));

  return (
    <Page
      title="New job"
      subtitle="A job is one piece of work for one client, with one kind of unit and one price."
      breadcrumbs={breadcrumbs}
      actions={
        <ButtonLink
          href={routes.newImport('jobs')}
          variant="secondary"
          icon={<FileSpreadsheet aria-hidden />}
          className="hidden sm:inline-flex"
        >
          Import many at once
        </ButtonLink>
      }
    >
      <NewJobWizard
        clients={clients}
        jobTypes={jobTypes}
        sites={sites}
        laborClasses={laborClasses}
        services={services}
        people={people}
        recentJobs={recent.map((job) => ({
          id: job.id,
          number: job.number,
          name: job.name,
          clientName: job.clientName,
        }))}
        deals={sources.deals}
        workOrders={sources.workOrders}
        seesMoney={page.access.seesMoney}
        defaults={{
          targetMarginBp: targetMarginBp({ orgDefault: settings.defaultTargetMarginBp }),
          loadedRateCents: settings.defaultLoadedRateCents,
          partsOwner: settings.defaultPartsOwner,
          sharedRule: settings.sharedCostRule,
          sharedPctBp: settings.sharedPctBp,
          shared90Cents: recentProfit?.total.sharedCents ?? null,
          labor90Cents: recentProfit?.total.laborCents ?? null,
          today,
          meId: ctx.userId,
        }}
        prefill={{
          clientName: prefillClient?.name,
          valueCents,
          dealId: first(query, 'crmDeal', 64) || undefined,
          workOrderId: first(query, 'wmsWorkOrder', 64) || undefined,
          projectId: first(query, 'project', 64) || undefined,
          program: program
            ? { id: program.id, key: program.key, name: program.name, unitLabel: first(query, 'unitLabel', 40) || program.unitPlural }
            : null,
          name: first(query, 'name') || (program ? program.name : undefined),
        }}
      />
    </Page>
  );
}
