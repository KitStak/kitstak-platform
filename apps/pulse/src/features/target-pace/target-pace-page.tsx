import { FileSpreadsheet, Gauge } from 'lucide-react';
import { Page, Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { Teach } from '@/components/pulse/teach';
import { PageBlocked } from '@/features/access/page-blocked';
import { routes } from '@/lib/routes';
import { pulsePage } from '@/server/page';

/** Target pace: units per person per hour targets by job type, client and service, and pace against them. */
export async function TargetPacePage() {
  const page = await pulsePage(routes.targetPace(), 'target-pace');
  if (page.blocked) return <PageBlocked title="Target pace" role={page.access.role} />;
  const canManage = page.can('standard:manage');
  return (
    <Page
      title="Target pace"
      subtitle="How many units one person should finish in an hour."
      actions={
        canManage ? (
          <ButtonLink href={routes.newImport('target_pace')} variant="secondary" icon={<FileSpreadsheet aria-hidden />}>
            Import target pace
          </ButtonLink>
        ) : null
      }
    >
      <Panel>
        <Teach
          icon={Gauge}
          title="No target pace set"
          why="A target pace is your yardstick: for example 42 units per person per hour for kitting. With a target, Pulse can tell you the moment a crew falls behind, and what that costs."
          points={['Targets by job type, client or extra service, each with a start date', 'Suggestions from your own history once you have logged about 20 days', 'Pace against target by job, labor class and day']}
          actions={
            <>
              {page.can('production:log') ? <ButtonLink href={routes.log()}>Log work to build history</ButtonLink> : null}
              {canManage ? (
                <ButtonLink href={routes.newImport('target_pace')} variant="secondary" icon={<FileSpreadsheet aria-hidden />}>
                  Import targets
                </ButtonLink>
              ) : null}
            </>
          }
          footnote={canManage ? undefined : 'A manager sets the targets. You will see your pace against them here and on the log.'}
        />
      </Panel>
    </Page>
  );
}
