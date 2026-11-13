/** Shared zod building blocks for server action inputs. */
import { z } from 'zod';
import {
  CUSTOM_FIELD_TYPES,
  DEPENDENCY_KINDS,
  GOAL_HEALTHS,
  GOAL_PROGRESS_MODES,
  INTEGRATION_TARGET_TYPES,
  KEY_RESULT_KINDS,
  PRIORITIES,
  PROJECT_HEALTHS,
  PROJECT_ROLES,
  PROJECT_STATUSES,
  PROJECT_VISIBILITIES,
  STATUS_CATEGORIES,
  VIEW_TYPES,
} from '@/lib/constants';

export const uuid = z.uuid({ message: 'That id is not valid.' });
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a valid date.');
export const nullableDate = isoDate.nullable();
export const name = (max = 200) => z.string().trim().min(1, 'This needs a name.').max(max, `Keep it under ${max} characters.`);
export const richText = z.string().max(200_000).nullable();
export const color = z.string().trim().min(1).max(32);
export const icon = z.string().trim().min(1).max(64);
export const rank = z.string().min(1).max(200);

export const priority = z.enum(PRIORITIES);
export const projectStatus = z.enum(PROJECT_STATUSES);
export const projectHealth = z.enum(PROJECT_HEALTHS);
export const projectRole = z.enum(PROJECT_ROLES);
export const projectVisibility = z.enum(PROJECT_VISIBILITIES);
export const statusCategory = z.enum(STATUS_CATEGORIES);
export const customFieldType = z.enum(CUSTOM_FIELD_TYPES);
export const viewType = z.enum(VIEW_TYPES);
export const goalHealth = z.enum(GOAL_HEALTHS);
export const goalProgressMode = z.enum(GOAL_PROGRESS_MODES);
export const keyResultKind = z.enum(KEY_RESULT_KINDS);
export const dependencyKind = z.enum(DEPENDENCY_KINDS);
export const integrationTargetType = z.enum(INTEGRATION_TARGET_TYPES);

export const recurrence = z
  .object({
    frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
    interval: z.number().int().min(1).max(365),
    weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  })
  .nullable();

export const placement = {
  afterTaskId: uuid.nullable().optional(),
  beforeTaskId: uuid.nullable().optional(),
  at: z.enum(['top', 'bottom']).optional(),
};

export const customFieldValues = z.record(z.string(), z.unknown());

/** Loose JSON object (view configs, automation rules, template payloads are validated in the domain). */
export const jsonObject = z.record(z.string(), z.unknown());
