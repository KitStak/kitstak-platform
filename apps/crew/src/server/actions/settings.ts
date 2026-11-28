'use server';
/** Settings actions: General, Sites and areas, Labor classes, People and roles (docs/crew/SPEC.md 6.1 `/settings`). */
import { z } from 'zod';
import { CREW_ROLES } from '@kitstak/crew-bridge';
import { archiveLaborClass, createLaborClass, LABOR_CLASS_KINDS, updateLaborClass } from '@/server/domain/labor-classes';
import { setMemberRole } from '@/server/domain/roles';
import { archiveArea, archiveSite, createArea, createSite, updateArea, updateGeneralSettings, updateSite } from '@/server/domain/sites';
import { runAction } from './_action';

const id = z.string().uuid();

const generalSchema = z.object({
  weekStart: z.number().int().min(0).max(6),
  pinLength: z.union([z.literal(4), z.literal(6)]),
  numberPrefixTemp: z.string().max(8),
  defaultMemberRole: z.string(),
  defaultTimezone: z.string().max(64),
  agencyLinks: z.boolean(),
});
export async function updateGeneralSettingsAction(input: z.input<typeof generalSchema>) {
  return runAction(generalSchema, input, async (data, ctx) => {
    await updateGeneralSettings(ctx, data);
    return { ok: true };
  });
}

const siteSchema = z.object({ code: z.string().max(20), name: z.string().max(80), timezone: z.string().max(64), weekStart: z.number().int().min(0).max(6), isDefault: z.boolean().optional() });
export async function createSiteAction(input: z.input<typeof siteSchema>) {
  return runAction(siteSchema, input, (data, ctx) => createSite(ctx, data));
}
const updateSiteSchema = siteSchema.extend({ siteId: id, version: z.number().int().min(1) });
export async function updateSiteAction(input: z.input<typeof updateSiteSchema>) {
  return runAction(updateSiteSchema, input, (data, ctx) => updateSite(ctx, data.siteId, data.version, data));
}
const siteIdSchema = z.object({ siteId: id });
export async function archiveSiteAction(input: z.input<typeof siteIdSchema>) {
  return runAction(siteIdSchema, input, (data, ctx) => archiveSite(ctx, data.siteId));
}

const areaSchema = z.object({ siteId: id, code: z.string().max(20), name: z.string().max(80) });
export async function createAreaAction(input: z.input<typeof areaSchema>) {
  return runAction(areaSchema, input, (data, ctx) => createArea(ctx, data));
}
const updateAreaSchema = z.object({ areaId: id, code: z.string().max(20), name: z.string().max(80), position: z.number().int().min(0).max(1000).optional() });
export async function updateAreaAction(input: z.input<typeof updateAreaSchema>) {
  return runAction(updateAreaSchema, input, (data, ctx) => updateArea(ctx, data.areaId, data));
}
const areaIdSchema = z.object({ areaId: id });
export async function archiveAreaAction(input: z.input<typeof areaIdSchema>) {
  return runAction(areaIdSchema, input, (data, ctx) => archiveArea(ctx, data.areaId));
}

const classSchema = z.object({ code: z.string().max(20), name: z.string().max(80), kind: z.enum(LABOR_CLASS_KINDS), isDefault: z.boolean().optional() });
export async function createLaborClassAction(input: z.input<typeof classSchema>) {
  return runAction(classSchema, input, (data, ctx) => createLaborClass(ctx, data));
}
const updateClassSchema = classSchema.extend({ classId: id });
export async function updateLaborClassAction(input: z.input<typeof updateClassSchema>) {
  return runAction(updateClassSchema, input, (data, ctx) => updateLaborClass(ctx, data.classId, data));
}
const classIdSchema = z.object({ classId: id });
export async function archiveLaborClassAction(input: z.input<typeof classIdSchema>) {
  return runAction(classIdSchema, input, (data, ctx) => archiveLaborClass(ctx, data.classId));
}

const roleSchema = z.object({ userId: id, role: z.enum(CREW_ROLES), siteIds: z.array(id).max(50).nullable().optional() });
export async function setMemberRoleAction(input: z.input<typeof roleSchema>) {
  return runAction(roleSchema, input, (data, ctx) => setMemberRole(ctx, data));
}
