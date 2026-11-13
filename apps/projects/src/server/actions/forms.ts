'use server';
import { headers } from 'next/headers';
import { z } from 'zod';
import type { FormField, FormSettings } from '@/lib/form-types';
import { createForm, deleteForm, restoreForm, submitForm, updateForm } from '@/server/domain';
import { DomainError } from '@/server/errors';
import { getContext } from '@/server/session';
import { runAction, runPublicAction } from './_action';
import { jsonObject, name, uuid } from './schemas';

const field = z.object({
  id: z.string().min(1).max(64),
  label: z.string().trim().min(1, 'Every question needs a label.').max(200),
  type: z.enum(['short_text', 'long_text', 'email', 'phone', 'number', 'date', 'select', 'multiselect', 'checkbox', 'url']),
  required: z.boolean(),
  helpText: z.string().max(500).optional(),
  placeholder: z.string().max(200).optional(),
  options: z.array(z.object({ id: z.string().min(1).max(64), label: z.string().trim().min(1).max(120) })).max(50).optional(),
  mapTo: z.string().max(80).nullable().optional(),
});

const formFields = {
  name: name(120),
  description: z.string().max(2000).nullable().optional(),
  fields: z.array(field).min(1, 'Add at least one question.').max(50),
  settings: jsonObject.optional(),
  isPublic: z.boolean().optional(),
  enabled: z.boolean().optional(),
};

const createSchema = z.object({ projectId: uuid, ...formFields });
export async function createFormAction(input: z.input<typeof createSchema>) {
  return runAction(createSchema, input, (data, ctx) =>
    createForm(ctx, { ...data, fields: data.fields as FormField[], settings: data.settings as FormSettings | undefined }),
  );
}

const updateSchema = z.object({
  formId: uuid,
  patch: z.object({ ...formFields, name: name(120).optional(), fields: formFields.fields.optional(), regenerateLink: z.boolean().optional() }),
});
export async function updateFormAction(input: z.input<typeof updateSchema>) {
  return runAction(updateSchema, input, (data, ctx) =>
    updateForm(ctx, data.formId, {
      ...data.patch,
      fields: data.patch.fields as FormField[] | undefined,
      settings: data.patch.settings as FormSettings | undefined,
    }),
  );
}

const idSchema = z.object({ formId: uuid });
export async function deleteFormAction(input: z.input<typeof idSchema>) {
  return runAction(idSchema, input, (data, ctx) => deleteForm(ctx, data.formId));
}
export async function restoreFormAction(input: z.input<typeof idSchema>) {
  return runAction(idSchema, input, (data, ctx) => restoreForm(ctx, data.formId));
}

// --- Public submit ---------------------------------------------------------------------------

const submitSchema = z.object({
  token: z.string().min(10).max(64),
  answers: z.record(z.string(), z.unknown()),
  submitterName: z.string().max(120).nullable().optional(),
  submitterEmail: z.string().max(200).nullable().optional(),
  /** Honeypot: real people never fill this hidden field. */
  website: z.string().max(0).optional(),
});

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 8;
const hits = new Map<string, number[]>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > RATE_MAX;
}

/** Anyone with the link can call this for public forms (no sign-in). */
export async function submitFormAction(input: z.input<typeof submitSchema>) {
  return runPublicAction(submitSchema, input, async (data) => {
    const requestHeaders = await headers();
    const ip = requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() || requestHeaders.get('x-real-ip') || 'unknown';
    if (rateLimited(`${ip}:${data.token}`)) {
      throw new DomainError('RATE_LIMITED', 'That was a lot of submissions in a short time. Wait a minute and try again.');
    }
    const context = await getContext();
    return submitForm({
      token: data.token,
      answers: data.answers,
      submitterName: data.submitterName,
      submitterEmail: data.submitterEmail,
      viewer: context ? { userId: context.user.id, name: context.user.name, orgIds: context.orgs.map((o) => o.id) } : null,
    });
  });
}
