import { index, integer, jsonb, text, uuid } from 'drizzle-orm/pg-core';
import { crmSchema } from './_schema';
import { deletedAt, fractionalKey, id, orgId, timestamps, userRef, widgetTypeEnum } from './_shared';
import { workspaces } from './workspaces';

export interface DashboardConfig {
  /** Boards feeding this dashboard's widgets by default. */
  readonly boardIds?: readonly string[];
  readonly [key: string]: unknown;
}

export const dashboards = crmSchema.table(
  'dashboards',
  {
    id: id(),
    orgId: orgId(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    config: jsonb('config').$type<DashboardConfig>().notNull().default({}),
    position: fractionalKey('position').notNull(),
    createdBy: userRef('created_by'),
    ...timestamps(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('dashboards_org_idx').on(t.orgId),
    index('dashboards_workspace_idx').on(t.workspaceId, t.position),
  ],
);

export const dashboardWidgets = crmSchema.table(
  'dashboard_widgets',
  {
    id: id(),
    orgId: orgId(),
    dashboardId: uuid('dashboard_id')
      .notNull()
      .references(() => dashboards.id, { onDelete: 'cascade' }),
    type: widgetTypeEnum('type').notNull(),
    title: text('title').notNull(),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    x: integer('x').notNull().default(0),
    y: integer('y').notNull().default(0),
    w: integer('w').notNull().default(4),
    h: integer('h').notNull().default(4),
    ...timestamps(),
  },
  (t) => [index('dashboard_widgets_dashboard_idx').on(t.dashboardId)],
);
