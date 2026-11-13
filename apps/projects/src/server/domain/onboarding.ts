/**
 * Onboarding helpers (studio team): a realistic sample project people can poke at, created
 * from the Product launch template, with a few tasks assigned to the person so Home and
 * My work light up straight away.
 */
import 'server-only';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { tasks } from '@/server/db/schema';
import { todayIso } from '@/lib/dates';
import type { ProjectDetail } from '@/lib/types';
import type { DomainContext } from './_shared';
import { requireOrg } from './access';
import { suggestKey } from './projects';
import { instantiateTemplate } from './templates';

export const SAMPLE_PROJECT_NAME = 'Sample project: Product launch';

export async function createSampleProject(ctx: DomainContext, options: { readonly spaceId?: string | null } = {}): Promise<ProjectDetail> {
  requireOrg(ctx, 'project:create');
  const key = await suggestKey(ctx, 'Sample launch');
  const project = await instantiateTemplate(ctx, 'builtin:product-launch', {
    name: SAMPLE_PROJECT_NAME,
    key,
    spaceId: options.spaceId ?? null,
    startDate: todayIso(),
    description:
      '<p>This is a practice project made from the <strong>Product launch</strong> template. Drag cards on the Board, check off tasks, try the Timeline, then delete it from Settings when you’re done.</p>',
    settings: { sample: true },
  });
  // Give the person the first few dated tasks so My work and Home have something real in them.
  const firstTasks = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.projectId, project.id), isNull(tasks.parentTaskId), isNull(tasks.deletedAt), sql`${tasks.dueDate} is not null`))
    .orderBy(asc(tasks.dueDate))
    .limit(4);
  if (firstTasks.length) {
    await db
      .update(tasks)
      .set({ assigneeId: ctx.userId })
      .where(sql`${tasks.id} in (${sql.join(firstTasks.map((t) => sql`${t.id}`), sql`, `)})`);
  }
  return project;
}
