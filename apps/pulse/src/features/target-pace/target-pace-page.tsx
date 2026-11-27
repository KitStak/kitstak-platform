import { FileSpreadsheet } from 'lucide-react';
import { Page } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { ExportStreamLink } from '@/components/pulse/export-link';
import { PageBlocked } from '@/features/access/page-blocked';
import { todayIso } from '@/lib/dates';
import { addDays } from '@/lib/profit';
import { routes } from '@/lib/routes';
import { getPaceBoard, getSettings, listJobTypes, listLaborClasses, listSites, listStandards, suggestAllStandards } from '@/server/domain';
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
  // The suggestions and the pace board are read here too, so the first paint is the whole page:
  // nothing loads in later and pushes the cards under it down. The board opens on the last 30 days.
  const boardRange = { from: addDays(today, -29), to: today };
  const [suggestions, board] = await Promise.all([
    suggestAllStandards(page.ctx).catch(() => undefined),
    getPaceBoard(page.ctx, boardRange).catch(() => undefined),
  ]);
  return (
    <Page
      title="Target pace"
      subtitle="How many units one person should finish in an hour, and how the floor is doing against it."
      actions={
        <>
          <ExportStreamLink stream="target_pace" />
          {canManage ? (
            <ButtonLink
              href={routes.newImport('target_pace')}
              variant="secondary"
              icon={<FileSpreadsheet aria-hidden />}
            >
              Import target pace
            </ButtonLink>
          ) : null}
        </>
      }
    >
      <TargetPaceView
        initialStandards={standards}
        initialSuggestions={suggestions}
        initialBoard={board ? { ...boardRange, board } : undefined}
        jobTypes={jobTypes}
        laborClasses={laborClasses}
        sites={sites}
        today={today}
        thresholds={{ watchBp: settings.productivityWatchBp, riskBp: settings.productivityRiskBp }}
      />
    </Page>
  );
}
