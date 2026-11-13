import { ProjectOverview } from '@/features/projects';
import type { OverviewInitial } from '@/features/projects/project-overview';
import { listGoalsForProject, listLinks, listProjectActivity, listProjectUpdates, requireProject } from '@/server/domain';
import { availableTargetTypes, integrationAvailability } from '@/server/integrations';
import { customer360 } from '@/server/integrations/customer360';
import { pageContext } from '@/server/page';

/** Resolves to undefined when a read fails or takes longer than `ms` (the client then loads it). */
function soft<T>(promise: Promise<T>, ms = 1500): Promise<T | undefined> {
  return Promise.race([promise.catch(() => undefined), new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms))]);
}

/** Everything the Overview shows besides the project itself (which the layout loads). */
async function loadOverview(key: string): Promise<OverviewInitial> {
  const { ctx } = await pageContext(`/p/${key}`);
  const { project } = await requireProject(ctx, { key });
  const [updates, activity, links, goals, availability, targetTypes, c360] = await Promise.all([
    soft(listProjectUpdates(ctx, project.id)),
    soft(listProjectActivity(ctx, project.id, { limit: 50 })),
    soft(listLinks(ctx, { projectId: project.id })),
    soft(listGoalsForProject(ctx, project.id)),
    soft(integrationAvailability(ctx)),
    soft(availableTargetTypes(ctx)),
    soft(customer360(ctx, project), 900),
  ]);
  return {
    loadedAt: Date.now(),
    updates,
    activity,
    links,
    goals,
    integrationStatus: availability && targetTypes ? { ...availability, targetTypes } : undefined,
    customer360: c360,
  };
}

/**
 * Overview: status updates, recent activity, linked records, goals and the customer picture load
 * on the server next to the project (the layout already has it), so the first HTML has real
 * sections instead of skeletons.
 */
export default async function Page({ params }: { readonly params: Promise<{ key: string }> }) {
  const { key } = await params;
  const initial = await loadOverview(decodeURIComponent(key));
  return <ProjectOverview initial={initial} />;
}
