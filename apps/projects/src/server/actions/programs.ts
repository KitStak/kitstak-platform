'use server';
import { z } from 'zod';
import {
  archiveProgram,
  copyProgram,
  createProgram,
  deleteDraft,
  deleteProgram,
  getProgramDetail,
  restoreProgram,
  saveDraft,
  saveProgramTemplate,
  setProgramStatus,
  updateProgram,
  updateProgramSettings,
} from '@/server/domain/programs';
import { postProjectUpdate } from '@/server/domain';
import { programWizardPayloadSchema } from '@/lib/program-types';
import { runAction } from './_action';
import { cents, isoDate, programKey, qty, uuid, version } from './program-schemas';

export async function createProgramAction(input: unknown) {
  return runAction(programWizardPayloadSchema, input, (data, ctx) => createProgram(ctx, data));
}

const draftSchema = z.object({ id: uuid.optional(), title: z.string().max(120), step: z.number().int().min(0).max(6), payload: z.record(z.string(), z.unknown()), expectedVersion: version.optional() });
export async function saveProgramDraftAction(input: z.input<typeof draftSchema>) {
  return runAction(draftSchema, input, (data, ctx) => saveDraft(ctx, { id: data.id, title: data.title, step: data.step, payload: data.payload }, data.expectedVersion), { revalidate: false });
}

export async function deleteProgramDraftAction(input: { id: string }) {
  return runAction(z.object({ id: uuid }), input, async (data, ctx) => {
    await deleteDraft(ctx, data.id);
    return {};
  }, { revalidate: false });
}

const updateSchema = z.object({
  key: programKey,
  patch: z.object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().max(200_000).nullable().optional(),
    ownerId: uuid.optional(),
    startDate: isoDate.nullable().optional(),
    endDate: isoDate.nullable().optional(),
    color: z.string().max(32).optional(),
    icon: z.string().max(64).optional(),
    visibility: z.enum(['org', 'private']).optional(),
    healthOverride: z.enum(['on_track', 'at_risk', 'off_track']).nullable().optional(),
  }),
});
export async function updateProgramAction(input: z.input<typeof updateSchema>) {
  return runAction(updateSchema, input, (data, ctx) => updateProgram(ctx, data.key, data.patch));
}

const statusSchema = z.object({ key: programKey, status: z.enum(['active', 'on_hold', 'completed']), futureBuilds: z.enum(['cancel', 'keep']).optional(), endsOn: isoDate.nullable().optional() });
export async function setProgramStatusAction(input: z.input<typeof statusSchema>) {
  return runAction(statusSchema, input, (data, ctx) => setProgramStatus(ctx, data.key, data.status, { futureBuilds: data.futureBuilds, endsOn: data.endsOn }));
}

const keyOnly = z.object({ key: programKey });
export async function archiveProgramAction(input: z.input<typeof keyOnly>) {
  return runAction(keyOnly, input, async (data, ctx) => {
    await archiveProgram(ctx, data.key);
    return {};
  });
}
export async function restoreProgramAction(input: z.input<typeof keyOnly>) {
  return runAction(keyOnly, input, async (data, ctx) => {
    await restoreProgram(ctx, data.key);
    return {};
  });
}
export async function deleteProgramAction(input: z.input<typeof keyOnly>) {
  return runAction(keyOnly, input, async (data, ctx) => {
    await deleteProgram(ctx, data.key);
    return {};
  });
}

const copySchema = z.object({
  key: programKey,
  name: z.string().trim().min(1).max(120),
  newKey: programKey,
  startDate: isoDate,
  include: z.object({ variants: z.boolean().optional(), priceCard: z.boolean().optional(), schedules: z.boolean().optional(), members: z.boolean().optional(), links: z.boolean().optional() }),
});
export async function copyProgramAction(input: z.input<typeof copySchema>) {
  return runAction(copySchema, input, (data, ctx) => copyProgram(ctx, data.key, { name: data.name, key: data.newKey, startDate: data.startDate, include: data.include }));
}

const templateSchema = z.object({ key: programKey, name: z.string().trim().min(1).max(120), description: z.string().max(2000).nullable().optional() });
export async function saveProgramTemplateAction(input: z.input<typeof templateSchema>) {
  return runAction(templateSchema, input, (data, ctx) => saveProgramTemplate(ctx, data.key, { name: data.name, description: data.description }), { revalidate: false });
}

const settingsSchema = z.object({
  key: programKey,
  expectedVersion: version,
  patch: z.object({
    unitSingular: z.string().max(24).optional(),
    unitPlural: z.string().max(24).optional(),
    timezone: z.string().max(64).optional(),
    workingDays: z.array(z.number().int().min(0).max(6)).max(7).nullable().optional(),
    useOrgHolidays: z.boolean().optional(),
    extraDaysOff: z.array(isoDate).max(400).optional(),
    extraWorkDays: z.array(isoDate).max(400).optional(),
    monthlyTargetCents: cents.nullable().optional(),
    dailyTargetUnits: qty.nullable().optional(),
    buildTitlePattern: z.string().max(120).optional(),
    autoStartOnOutput: z.boolean().optional(),
    autoDoneWhenFull: z.boolean().optional(),
    moneyMinRole: z.enum(['owner', 'editor', 'commenter', 'viewer']).optional(),
    hourlyTimeBasis: z.enum(['billable', 'all']).optional(),
    remindAt: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  }),
});
export async function updateProgramSettingsAction(input: z.input<typeof settingsSchema>) {
  return runAction(settingsSchema, input, (data, ctx) => updateProgramSettings(ctx, data.key, data.patch, data.expectedVersion), { revalidate: false });
}

const updatePostSchema = z.object({ key: programKey, health: z.enum(['on_track', 'at_risk', 'off_track']), body: z.string().trim().min(1, 'Write a short update.').max(20_000) });
export async function postProgramUpdateAction(input: z.input<typeof updatePostSchema>) {
  return runAction(updatePostSchema, input, async (data, ctx) => {
    const detail = await getProgramDetail(ctx, data.key);
    const posted = await postProjectUpdate(ctx, detail.id, { health: data.health, note: data.body });
    return posted.update;
  }, { revalidate: false });
}
