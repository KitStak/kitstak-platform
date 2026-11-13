/**
 * CRM "Getting started" guide: live org setup state + explicit skip/dismiss writes.
 *
 * Completion signals are derived from REAL data (boards, deal items, members,
 * invitations, dashboards) — see setup-guide-model.ts for the derivation rules and
 * docs/integration/ONBOARDING.md for the binding cross-app contract. Only skips and
 * the org-level guide row persist (user_id NULL, scope 'crm') in the shared
 * `core.onboarding_progress` table; the portal's cross-app setup guide reads the
 * same table.
 *
 * Rollout guard: the first time the guide renders in an incomplete state, a 'guide'
 * row with status 'completed' is written as a "seen" marker — via `after()`, never
 * inline in the request path (serverless pool rule). Orgs that were already fully
 * set up before this shipped never see the guide or a surprise celebration.
 */
import { after } from 'next/server';
import { and, asc, count, eq, gt, isNull, notLike, sql } from 'drizzle-orm';
import { z } from 'zod';
import { onboardingProgress } from '@kitstak/db/schema';
import { boards, dashboards, invitation, items, member } from '@/server/db/schema';
import { logger } from '@/server/logger';
import { concurrently, type ServiceContext } from './context';
import {
  buildSetupGuide,
  SETUP_GUIDE_ROW_KEY,
  SETUP_GUIDE_SCOPE,
  SETUP_STEP_KEYS,
  type SetupGuideActionInput,
  type SetupGuideDto,
  type SetupGuideSignals,
  type SetupProgressRow,
} from './setup-guide-model';

export * from './setup-guide-model';

/** Members whose role carries this prefix are deactivated and never count as "team". */
const DEACTIVATED_ROLE_PREFIX = 'deactivated:';

const stepKeySchema = z.enum(SETUP_STEP_KEYS);

export const setupGuideActionSchema: z.ZodType<SetupGuideActionInput> = z.discriminatedUnion(
  'action',
  [
    z.object({ action: z.literal('skip'), stepKey: stepKeySchema }),
    z.object({ action: z.literal('unskip'), stepKey: stepKeySchema }),
    z.object({ action: z.literal('dismiss') }),
    z.object({ action: z.literal('restore') }),
  ],
);

const liveBoards = (ctx: ServiceContext) =>
  and(eq(boards.orgId, ctx.orgId), isNull(boards.deletedAt), isNull(boards.archivedAt));

async function loadSignals(ctx: ServiceContext): Promise<SetupGuideSignals> {
  const [boardRows, dealsBoardRows, dealRows, memberRows, inviteRows, dashboardRows] =
    await concurrently(ctx, [
      () => ctx.db.select({ id: boards.id }).from(boards).where(liveBoards(ctx)).limit(1),
      () =>
        ctx.db
          .select({ id: boards.id })
          .from(boards)
          .where(and(liveBoards(ctx), eq(boards.kind, 'deals')))
          .orderBy(asc(boards.createdAt))
          .limit(1),
      // Contract predicate: non-deleted top-level item on a non-deleted, NON-ARCHIVED
      // deals board (archived pipelines don't count as a live first deal).
      () =>
        ctx.db
          .select({ id: items.id })
          .from(items)
          .innerJoin(boards, eq(boards.id, items.boardId))
          .where(
            and(
              eq(items.orgId, ctx.orgId),
              isNull(items.deletedAt),
              isNull(items.parentItemId),
              eq(boards.kind, 'deals'),
              isNull(boards.deletedAt),
              isNull(boards.archivedAt),
            ),
          )
          .limit(1),
      // Contract predicate: active members only — deactivated roles are excluded.
      () =>
        ctx.db
          .select({ total: count() })
          .from(member)
          .where(
            and(
              eq(member.organizationId, ctx.orgId),
              notLike(member.role, `${DEACTIVATED_ROLE_PREFIX}%`),
            ),
          ),
      // Contract predicate: pending AND unexpired invitations only.
      () =>
        ctx.db
          .select({ id: invitation.id })
          .from(invitation)
          .where(
            and(
              eq(invitation.organizationId, ctx.orgId),
              eq(invitation.status, 'pending'),
              gt(invitation.expiresAt, new Date()),
            ),
          )
          .limit(1),
      () =>
        ctx.db
          .select({ id: dashboards.id })
          .from(dashboards)
          .where(and(eq(dashboards.orgId, ctx.orgId), isNull(dashboards.deletedAt)))
          .limit(1),
    ]);

  return {
    hasBoard: boardRows.length > 0,
    hasDeal: dealRows.length > 0,
    hasTeam: Number(memberRows[0]?.total ?? 0) > 1 || inviteRows.length > 0,
    hasDashboard: dashboardRows.length > 0,
    dealsBoardId: dealsBoardRows[0]?.id ?? null,
  };
}

async function loadProgressRows(ctx: ServiceContext): Promise<SetupProgressRow[]> {
  // invite_team is a PORTAL-scope step (contract): its skip rows are shared with the
  // portal guide, so the same canonical step never reads skipped in one app and ready
  // in the other.
  return ctx.db
    .select({ stepKey: onboardingProgress.stepKey, status: onboardingProgress.status })
    .from(onboardingProgress)
    .where(
      and(
        eq(onboardingProgress.orgId, ctx.orgId),
        isNull(onboardingProgress.userId),
        sql`(${onboardingProgress.scope} = ${SETUP_GUIDE_SCOPE}
             or (${onboardingProgress.scope} = 'portal' and ${onboardingProgress.stepKey} = 'invite_team'))`,
      ),
    );
}

export interface GetSetupGuideOptions {
  /**
   * GET route path only: when the guide is visible and incomplete and no seen marker
   * exists yet, write the org-level 'guide' row (status 'completed') AFTER the
   * response — never inline in the request path.
   */
  readonly recordSeen?: boolean;
}

/** The guide DTO the home card renders. */
export async function getSetupGuide(
  ctx: ServiceContext,
  options: GetSetupGuideOptions = {},
): Promise<SetupGuideDto> {
  const [signals, rows] = await concurrently(ctx, [
    () => loadSignals(ctx),
    () => loadProgressRows(ctx),
  ]);
  const guide = buildSetupGuide(signals, rows);
  if (options.recordSeen && guide.visible && !guide.allDone && !guide.seen) {
    try {
      after(async () => {
        try {
          // onConflictDoNothing: a 'dismissed' row written between derive and this
          // deferred callback must never be overwritten back to seen.
          await ctx.db
            .insert(onboardingProgress)
            .values({
              orgId: ctx.orgId,
              userId: null,
              scope: SETUP_GUIDE_SCOPE,
              stepKey: SETUP_GUIDE_ROW_KEY,
              status: 'completed',
              completedBy: ctx.userId,
            })
            .onConflictDoNothing();
        } catch (error: unknown) {
          logger.warn('setup_guide.seen_marker_failed', { orgId: ctx.orgId, error });
        }
      });
    } catch (error: unknown) {
      // Outside a request scope (tests, scripts): the next GET records it instead.
      logger.warn('setup_guide.seen_marker_deferred_failed', { orgId: ctx.orgId, error });
    }
  }
  return guide;
}

/** invite_team rows live under the portal scope so the skip is shared cross-app. */
function scopeForStep(stepKey: string): 'crm' | 'portal' {
  return stepKey === 'invite_team' ? 'portal' : SETUP_GUIDE_SCOPE;
}

/** Org-level upsert (user_id NULL) — must target the partial unique index. */
async function upsertOrgRow(
  ctx: ServiceContext,
  stepKey: string,
  status: 'completed' | 'skipped' | 'dismissed',
): Promise<void> {
  await ctx.db
    .insert(onboardingProgress)
    .values({
      orgId: ctx.orgId,
      userId: null,
      scope: scopeForStep(stepKey),
      stepKey,
      status,
      completedBy: ctx.userId,
    })
    .onConflictDoUpdate({
      target: [onboardingProgress.orgId, onboardingProgress.scope, onboardingProgress.stepKey],
      targetWhere: sql`user_id IS NULL`,
      set: { status, completedBy: ctx.userId, updatedAt: new Date() },
    });
}

async function deleteOrgRow(
  ctx: ServiceContext,
  stepKey: string,
  status: 'skipped' | 'dismissed',
): Promise<void> {
  await ctx.db
    .delete(onboardingProgress)
    .where(
      and(
        eq(onboardingProgress.orgId, ctx.orgId),
        eq(onboardingProgress.scope, scopeForStep(stepKey)),
        eq(onboardingProgress.stepKey, stepKey),
        isNull(onboardingProgress.userId),
        eq(onboardingProgress.status, status),
      ),
    );
}

/** Apply a skip/unskip/dismiss/restore and return the fresh guide state. */
export async function applySetupGuideAction(
  ctx: ServiceContext,
  input: SetupGuideActionInput,
): Promise<SetupGuideDto> {
  switch (input.action) {
    case 'skip':
      await upsertOrgRow(ctx, input.stepKey, 'skipped');
      break;
    case 'unskip':
      await deleteOrgRow(ctx, input.stepKey, 'skipped');
      break;
    case 'dismiss':
      await upsertOrgRow(ctx, SETUP_GUIDE_ROW_KEY, 'dismissed');
      break;
    case 'restore':
      // Restoring flips the guide row back to the seen marker ('completed'), so the
      // guide stays visible even for an all-done org (the user explicitly asked).
      await upsertOrgRow(ctx, SETUP_GUIDE_ROW_KEY, 'completed');
      break;
  }
  return getSetupGuide(ctx);
}
