/**
 * core.onboarding_progress — durable guided-setup state shared by portal, CRM and WMS.
 *
 * One row per explicit onboarding action. Most setup steps are DERIVED live from real
 * data (members, boards, warehouses, orders) and never stored; rows exist only for what
 * the system cannot observe: wizard answers ('profile' payload), user skips, and guide
 * dismissals. user_id NULL = org-level state; set = per-user state (dismissals).
 */
import { sql } from 'drizzle-orm';
import { check, index, jsonb, text, unique, uniqueIndex } from 'drizzle-orm/pg-core';
import { auditUserRef, coreSchema, createdAt, id, orgId, updatedAt } from '../_shared';

/** Wider than the entitlements Module union: portal-level steps are module-agnostic. */
export const ONBOARDING_SCOPES = ['portal', 'crm', 'wms'] as const;
export type OnboardingScope = (typeof ONBOARDING_SCOPES)[number];

export const ONBOARDING_STATUSES = ['completed', 'skipped', 'dismissed'] as const;
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];

export const onboardingProgress = coreSchema.table(
  'onboarding_progress',
  {
    id: id(),
    orgId: orgId(),
    /** NULL = org-level step state; set = per-user state (e.g. a personal dismissal). */
    userId: auditUserRef('user_id'),
    scope: text('scope', { enum: ONBOARDING_SCOPES }).notNull(),
    /** Free-form step key ('profile', 'invite_team', ...) so steps evolve without DDL. */
    stepKey: text('step_key').notNull(),
    status: text('status', { enum: ONBOARDING_STATUSES }).notNull().default('completed'),
    /** Step-specific data, e.g. the welcome-wizard answers on the 'profile' step. */
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    completedBy: auditUserRef('completed_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('onboarding_progress_org_scope_step_user_unique').on(
      t.orgId,
      t.scope,
      t.stepKey,
      t.userId,
    ),
    // Postgres unique treats NULLs as distinct; org-level upserts need this partial target.
    uniqueIndex('onboarding_progress_org_scope_step_org_level_unique')
      .on(t.orgId, t.scope, t.stepKey)
      .where(sql`user_id IS NULL`),
    index('onboarding_progress_org_id_idx').on(t.orgId),
    check('onboarding_progress_scope_check', sql`${t.scope} IN ('portal', 'crm', 'wms')`),
    check(
      'onboarding_progress_status_check',
      sql`${t.status} IN ('completed', 'skipped', 'dismissed')`,
    ),
  ],
);

export type OnboardingProgress = typeof onboardingProgress.$inferSelect;
export type NewOnboardingProgress = typeof onboardingProgress.$inferInsert;
