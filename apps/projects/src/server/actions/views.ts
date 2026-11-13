'use server';
import { z } from 'zod';
import type { DashboardWidget } from '@/server/db/schema';
import {
  createDashboard,
  createSavedView,
  deleteDashboard,
  deleteSavedView,
  updateDashboard,
  updateSavedView,
} from '@/server/domain';
import type { ViewConfig } from '@/lib/view-config';
import { runAction } from './_action';
import { jsonObject, name, rank, uuid, viewType } from './schemas';

const createViewSchema = z.object({
  projectId: uuid.nullable(),
  name: name(80),
  type: viewType,
  config: jsonObject,
  shared: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});
export async function createSavedViewAction(input: z.input<typeof createViewSchema>) {
  return runAction(createViewSchema, input, (data, ctx) => createSavedView(ctx, { ...data, config: data.config as ViewConfig }));
}

const updateViewSchema = z.object({
  viewId: uuid,
  patch: z.object({ name: name(80).optional(), config: jsonObject.optional(), isDefault: z.boolean().optional(), position: rank.optional() }),
});
export async function updateSavedViewAction(input: z.input<typeof updateViewSchema>) {
  return runAction(updateViewSchema, input, (data, ctx) =>
    updateSavedView(ctx, data.viewId, { ...data.patch, config: data.patch.config as ViewConfig | undefined }),
  );
}

const viewIdSchema = z.object({ viewId: uuid });
export async function deleteSavedViewAction(input: z.input<typeof viewIdSchema>) {
  return runAction(viewIdSchema, input, (data, ctx) => deleteSavedView(ctx, data.viewId));
}

const widget = z.object({
  id: z.string().min(1).max(64),
  type: z.string().min(1).max(64),
  title: z.string().max(120).optional(),
  x: z.number().int().min(0).max(48),
  y: z.number().int().min(0).max(500),
  w: z.number().int().min(1).max(48),
  h: z.number().int().min(1).max(48),
  options: jsonObject.optional(),
});
const dashboardFields = {
  name: name(120),
  description: z.string().max(1000).nullable().optional(),
  widgets: z.array(widget).max(60).optional(),
  filters: jsonObject.optional(),
};
const createDashboardSchema = z.object({ projectId: uuid.nullable().optional(), ...dashboardFields });
export async function createDashboardAction(input: z.input<typeof createDashboardSchema>) {
  return runAction(createDashboardSchema, input, (data, ctx) => createDashboard(ctx, { ...data, widgets: data.widgets as DashboardWidget[] | undefined }));
}
const updateDashboardSchema = z.object({ dashboardId: uuid, patch: z.object({ ...dashboardFields, name: name(120).optional(), position: rank.optional() }) });
export async function updateDashboardAction(input: z.input<typeof updateDashboardSchema>) {
  return runAction(updateDashboardSchema, input, (data, ctx) =>
    updateDashboard(ctx, data.dashboardId, { ...data.patch, widgets: data.patch.widgets as DashboardWidget[] | undefined }),
  );
}
const dashboardIdSchema = z.object({ dashboardId: uuid });
export async function deleteDashboardAction(input: z.input<typeof dashboardIdSchema>) {
  return runAction(dashboardIdSchema, input, (data, ctx) => deleteDashboard(ctx, data.dashboardId));
}
