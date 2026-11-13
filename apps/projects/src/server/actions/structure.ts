'use server';
import { z } from 'zod';
import {
  createCustomField,
  createLabel,
  createMilestone,
  createSection,
  createStatus,
  deleteCustomField,
  deleteLabel,
  deleteMilestone,
  deleteSection,
  deleteStatus,
  updateCustomField,
  updateLabel,
  updateMilestone,
  updateSection,
  updateStatus,
} from '@/server/domain';
import { runAction } from './_action';
import { color, customFieldType, jsonObject, name, nullableDate, rank, statusCategory, uuid } from './schemas';

// Statuses
const createStatusSchema = z.object({ projectId: uuid, name: name(80), category: statusCategory, color: color.optional(), wipLimit: z.number().int().min(1).max(999).nullable().optional(), position: rank.optional() });
export async function createStatusAction(input: z.input<typeof createStatusSchema>) {
  return runAction(createStatusSchema, input, (data, ctx) => createStatus(ctx, data.projectId, data));
}
const updateStatusSchema = z.object({
  statusId: uuid,
  patch: z.object({ name: name(80).optional(), category: statusCategory.optional(), color: color.optional(), wipLimit: z.number().int().min(1).max(999).nullable().optional(), position: rank.optional(), isDefault: z.boolean().optional() }),
});
export async function updateStatusAction(input: z.input<typeof updateStatusSchema>) {
  return runAction(updateStatusSchema, input, (data, ctx) => updateStatus(ctx, data.statusId, data.patch));
}
const deleteStatusSchema = z.object({ statusId: uuid, moveToStatusId: uuid.optional() });
export async function deleteStatusAction(input: z.input<typeof deleteStatusSchema>) {
  return runAction(deleteStatusSchema, input, (data, ctx) => deleteStatus(ctx, data.statusId, data.moveToStatusId));
}

// Sections
const createSectionSchema = z.object({ projectId: uuid, name: name(80), position: rank.optional() });
export async function createSectionAction(input: z.input<typeof createSectionSchema>) {
  return runAction(createSectionSchema, input, (data, ctx) => createSection(ctx, data.projectId, data));
}
const updateSectionSchema = z.object({ sectionId: uuid, patch: z.object({ name: name(80).optional(), position: rank.optional() }) });
export async function updateSectionAction(input: z.input<typeof updateSectionSchema>) {
  return runAction(updateSectionSchema, input, (data, ctx) => updateSection(ctx, data.sectionId, data.patch));
}
const deleteSectionSchema = z.object({ sectionId: uuid, moveToSectionId: uuid.nullable().optional() });
export async function deleteSectionAction(input: z.input<typeof deleteSectionSchema>) {
  return runAction(deleteSectionSchema, input, (data, ctx) => deleteSection(ctx, data.sectionId, data.moveToSectionId));
}

// Labels
const createLabelSchema = z.object({ projectId: uuid.nullable(), name: name(40), color: color.optional() });
export async function createLabelAction(input: z.input<typeof createLabelSchema>) {
  return runAction(createLabelSchema, input, (data, ctx) => createLabel(ctx, data));
}
const updateLabelSchema = z.object({ labelId: uuid, patch: z.object({ name: name(40).optional(), color: color.optional() }) });
export async function updateLabelAction(input: z.input<typeof updateLabelSchema>) {
  return runAction(updateLabelSchema, input, (data, ctx) => updateLabel(ctx, data.labelId, data.patch));
}
const deleteLabelSchema = z.object({ labelId: uuid });
export async function deleteLabelAction(input: z.input<typeof deleteLabelSchema>) {
  return runAction(deleteLabelSchema, input, (data, ctx) => deleteLabel(ctx, data.labelId));
}

// Custom fields
const fieldConfig = jsonObject.optional();
const createFieldSchema = z.object({ projectId: uuid.nullable(), name: name(80), type: customFieldType, config: fieldConfig, description: z.string().max(500).nullable().optional(), required: z.boolean().optional() });
export async function createCustomFieldAction(input: z.input<typeof createFieldSchema>) {
  return runAction(createFieldSchema, input, (data, ctx) => createCustomField(ctx, data));
}
const updateFieldSchema = z.object({
  fieldId: uuid,
  patch: z.object({ name: name(80).optional(), config: fieldConfig, description: z.string().max(500).nullable().optional(), required: z.boolean().optional(), position: rank.optional() }),
});
export async function updateCustomFieldAction(input: z.input<typeof updateFieldSchema>) {
  return runAction(updateFieldSchema, input, (data, ctx) => updateCustomField(ctx, data.fieldId, data.patch));
}
const deleteFieldSchema = z.object({ fieldId: uuid });
export async function deleteCustomFieldAction(input: z.input<typeof deleteFieldSchema>) {
  return runAction(deleteFieldSchema, input, (data, ctx) => deleteCustomField(ctx, data.fieldId));
}

// Milestones
const createMilestoneSchema = z.object({ projectId: uuid, name: name(120), description: z.string().max(2000).nullable().optional(), dueDate: nullableDate.optional() });
export async function createMilestoneAction(input: z.input<typeof createMilestoneSchema>) {
  return runAction(createMilestoneSchema, input, (data, ctx) => createMilestone(ctx, data.projectId, data));
}
const updateMilestoneSchema = z.object({
  milestoneId: uuid,
  patch: z.object({ name: name(120).optional(), description: z.string().max(2000).nullable().optional(), dueDate: nullableDate.optional(), completed: z.boolean().optional(), position: rank.optional() }),
});
export async function updateMilestoneAction(input: z.input<typeof updateMilestoneSchema>) {
  return runAction(updateMilestoneSchema, input, (data, ctx) => updateMilestone(ctx, data.milestoneId, data.patch));
}
const deleteMilestoneSchema = z.object({ milestoneId: uuid });
export async function deleteMilestoneAction(input: z.input<typeof deleteMilestoneSchema>) {
  return runAction(deleteMilestoneSchema, input, (data, ctx) => deleteMilestone(ctx, data.milestoneId));
}
