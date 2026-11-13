'use server';
import { z } from 'zod';
import type { TemplatePayload } from '@/lib/template-types';
import { createTemplate, deleteTemplate, restoreTemplate, updateTemplate } from '@/server/domain';
import { runAction } from './_action';
import { color, icon, jsonObject, name } from './schemas';

const fields = {
  name: name(120),
  description: z.string().max(1000).nullable().optional(),
  category: z.string().max(60).optional(),
  icon: icon.optional(),
  color: color.optional(),
};

const createSchema = z.object({ ...fields, payload: jsonObject });
export async function createTemplateAction(input: z.input<typeof createSchema>) {
  return runAction(createSchema, input, (data, ctx) => createTemplate(ctx, { ...data, payload: data.payload as unknown as TemplatePayload }));
}

const updateSchema = z.object({ templateId: z.string().min(1).max(80), patch: z.object({ ...fields, name: name(120).optional(), payload: jsonObject.optional() }) });
export async function updateTemplateAction(input: z.input<typeof updateSchema>) {
  return runAction(updateSchema, input, (data, ctx) =>
    updateTemplate(ctx, data.templateId, { ...data.patch, payload: data.patch.payload as unknown as TemplatePayload | undefined }),
  );
}

const idSchema = z.object({ templateId: z.string().min(1).max(80) });
export async function deleteTemplateAction(input: z.input<typeof idSchema>) {
  return runAction(idSchema, input, (data, ctx) => deleteTemplate(ctx, data.templateId));
}
export async function restoreTemplateAction(input: z.input<typeof idSchema>) {
  return runAction(idSchema, input, (data, ctx) => restoreTemplate(ctx, data.templateId));
}
