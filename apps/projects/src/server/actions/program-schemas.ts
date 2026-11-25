/** Zod schemas for program server actions (docs/programs/SPEC.md 4.6). Reuses `schemas.ts` pieces and `lib/program-types` payloads. */
import { z } from 'zod';
import {
  attributeAxisInputSchema,
  cardLineInputSchema,
  endOfDaySchema,
  outputEntrySchema,
  rateRuleInputSchema,
  scheduleInputSchema,
} from '@/lib/program-types';
import { isoDate, uuid } from './schemas';

export const programKey = z.string().trim().min(2).max(6).regex(/^[A-Za-z][A-Za-z0-9]{1,5}$/, 'That program key is not valid.').transform((v) => v.toUpperCase());
export const containerKey = z.string().trim().min(2).max(40);
export const isoMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Pick a month.');
export const qty = z.string().trim().regex(/^\d{1,8}(\.\d{1,3})?$/, 'Use a number with up to 3 decimals.');
export const price = z.string().trim().regex(/^\$?\d{1,6}(\.\d{1,4})?$/, 'Use a price with up to 4 decimals.');
export const cents = z.string().trim().regex(/^-?\d{1,13}$/, 'Use whole cents.');
export const version = z.number().int().min(0);
export const runIdSchema = z.string().regex(/^run:[^:]+:\d{4}-\d{2}-\d{2}$/, 'That run is not valid.');

export const resolvedLineSchema = cardLineInputSchema;
export const lines = z.array(resolvedLineSchema).max(250);
export const rules = z.array(rateRuleInputSchema).max(120);
export const axes = z.array(attributeAxisInputSchema).max(4);
export { endOfDaySchema, outputEntrySchema, scheduleInputSchema, isoDate, uuid };
