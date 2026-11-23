'use server';
import { z } from 'zod';
import {
  addProjectMembers,
  archiveProject,
  createProject,
  deleteProject,
  duplicateProject,
  instantiateTemplate,
  removeProjectMember,
  reorderProject,
  restoreProject,
  saveProjectAsTemplate,
  starProject,
  suggestKey,
  updateProject,
  updateProjectMemberRole,
} from '@/server/domain';
import { runAction } from './_action';
import {
  color,
  icon,
  jsonObject,
  name,
  nullableDate,
  projectHealth,
  projectRole,
  projectStatus,
  projectVisibility,
  rank,
  richText,
  uuid,
} from './schemas';

const key = z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9]{1,5}$/, 'Use 2-6 letters or numbers, starting with a letter.');

const projectFields = {
  name: name(120),
  key: key.optional(),
  description: richText.optional(),
  spaceId: uuid.nullable().optional(),
  ownerId: uuid.nullable().optional(),
  status: projectStatus.optional(),
  health: projectHealth.optional(),
  startDate: nullableDate.optional(),
  dueDate: nullableDate.optional(),
  color: color.optional(),
  icon: icon.optional(),
  visibility: projectVisibility.optional(),
  crmCustomerId: uuid.nullable().optional(),
  crmItemId: uuid.nullable().optional(),
  wmsRef: jsonObject.nullable().optional(),
  members: z.array(z.object({ userId: uuid, role: projectRole })).max(200).optional(),
};

const createSchema = z.object({
  ...projectFields,
  /** `builtin:<slug>` or an org template id. Omit for a blank project. */
  templateId: z.string().min(1).max(80).optional(),
  includeTemplateTasks: z.boolean().optional(),
});
export type CreateProjectActionInput = z.input<typeof createSchema>;

/** Create a blank project or one from a template. Returns ProjectDetail (navigate to /p/<key>). */
export async function createProjectAction(input: CreateProjectActionInput) {
  return runAction(createSchema, input, (data, ctx) => {
    const { templateId, includeTemplateTasks, ...rest } = data;
    return templateId
      ? instantiateTemplate(ctx, templateId, { ...rest, includeTasks: includeTemplateTasks ?? true })
      : createProject(ctx, rest);
  });
}

const updateSchema = z.object({
  projectId: uuid,
  patch: z.object({
    ...projectFields,
    name: name(120).optional(),
    healthNote: z.string().max(500).nullable().optional(),
    settings: jsonObject.optional(),
  }).omit({ members: true }),
});
export async function updateProjectAction(input: z.input<typeof updateSchema>) {
  return runAction(updateSchema, input, (data, ctx) => updateProject(ctx, data.projectId, data.patch));
}

const archiveSchema = z.object({ projectId: uuid, archived: z.boolean() });
export async function archiveProjectAction(input: z.input<typeof archiveSchema>) {
  return runAction(archiveSchema, input, (data, ctx) => archiveProject(ctx, data.projectId, data.archived));
}

const idSchema = z.object({ projectId: uuid });
export async function deleteProjectAction(input: z.input<typeof idSchema>) {
  return runAction(idSchema, input, (data, ctx) => deleteProject(ctx, data.projectId));
}
export async function restoreProjectAction(input: z.input<typeof idSchema>) {
  return runAction(idSchema, input, (data, ctx) => restoreProject(ctx, data.projectId));
}

const duplicateSchema = z.object({ projectId: uuid, name: name(120), key: key.optional(), includeTasks: z.boolean().optional() });
export async function duplicateProjectAction(input: z.input<typeof duplicateSchema>) {
  return runAction(duplicateSchema, input, (data, ctx) => duplicateProject(ctx, data.projectId, data));
}

const starSchema = z.object({ projectId: uuid, starred: z.boolean() });
export async function starProjectAction(input: z.input<typeof starSchema>) {
  return runAction(starSchema, input, (data, ctx) => starProject(ctx, data.projectId, data.starred));
}

const reorderSchema = z.object({ projectId: uuid, position: rank, spaceId: uuid.nullable().optional() });
export async function reorderProjectAction(input: z.input<typeof reorderSchema>) {
  return runAction(reorderSchema, input, (data, ctx) => reorderProject(ctx, data.projectId, data.position, data.spaceId));
}

const membersSchema = z.object({ projectId: uuid, members: z.array(z.object({ userId: uuid, role: projectRole })).min(1).max(200) });
export async function addProjectMembersAction(input: z.input<typeof membersSchema>) {
  return runAction(membersSchema, input, (data, ctx) => addProjectMembers(ctx, data.projectId, data.members));
}

const roleSchema = z.object({ projectId: uuid, userId: uuid, role: projectRole });
export async function updateProjectMemberRoleAction(input: z.input<typeof roleSchema>) {
  return runAction(roleSchema, input, (data, ctx) => updateProjectMemberRole(ctx, data.projectId, data.userId, data.role));
}

const removeSchema = z.object({ projectId: uuid, userId: uuid });
export async function removeProjectMemberAction(input: z.input<typeof removeSchema>) {
  return runAction(removeSchema, input, (data, ctx) => removeProjectMember(ctx, data.projectId, data.userId));
}

const templateSchema = z.object({
  projectId: uuid,
  name: name(120),
  description: z.string().max(1000).nullable().optional(),
  category: z.string().max(60).optional(),
  includeTasks: z.boolean().optional(),
});
export async function saveProjectAsTemplateAction(input: z.input<typeof templateSchema>) {
  return runAction(templateSchema, input, (data, ctx) => saveProjectAsTemplate(ctx, data.projectId, data));
}

const suggestSchema = z.object({ name: z.string().max(120) });
/** Suggested free project key for a name ("Warehouse go-live" → "WGL"). */
export async function suggestProjectKeyAction(input: z.input<typeof suggestSchema>) {
  return runAction(suggestSchema, input, (data, ctx) => suggestKey(ctx, data.name), { revalidate: false, read: true });
}
