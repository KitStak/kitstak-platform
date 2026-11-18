import { FileSpreadsheet } from 'lucide-react';
import { Page } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { PageBlocked } from '@/features/access/page-blocked';
import { todayIso } from '@/lib/dates';
import { routes } from '@/lib/routes';
import { getSettings, listJobTypes, listLaborClasses, listSites, listStandards } from '@/server/domain';
import { pulsePage } from '@/server/page';
import { TargetPaceView } from './target-pace-view';

/** Target pace: units per person per hour targets by job type, client and service, and pace against them. */
export async function TargetPacePage() {
  const page = await pulsePage(routes.targetPace(), 'target-pace');
  if (page.blocked) return <PageBlocked title="Target pace" role={page.access.role} />;
  const canManage = page.can('standard:manage');
  const [standards, jobTypes, laborClasses, sites, settings] = await Promise.all([
    listStandards(page.ctx),
    listJobTypes(page.ctx, { includeArchived: true }),
    listLaborClasses(page.ctx, { includeArchived: true }),
    listSites(page.ctx),
    getSettings(page.ctx),
  ]);
  const today = sites.find((site) => site.isDefault)?.today ?? sites[0]?.today ?? todayIso();
  return (
    <Page
      title="Target pace"
      subtitle="How many units one person should finish in an hour, and how the floor is doing against it."
      actions={
        canManage ? (
          <ButtonLink
            href={routes.newImport('target_pace')}
            variant="secondary"
            icon={<FileSpreadsheet aria-hidden />}
          >
            Import target pace
          </ButtonLink>
        ) : null
      }
    >
      <TargetPaceView
        initialStandards={standards}
        jobTypes={jobTypes}
        laborClasses={laborClasses}
        sites={sites}
        today={today}
        thresholds={{ watchBp: settings.productivityWatchBp, riskBp: settings.productivityRiskBp }}
      />
    </Page>
  );
}
