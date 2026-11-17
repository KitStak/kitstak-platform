/** Shared zod pieces for server actions and route bodies (NOT a 'use server' file). */
import { z } from 'zod';
import {
  ALERT_KINDS,
  ALERT_SEVERITIES,
  COST_CATEGORIES,
  INDIRECT_REASONS,
  JOB_KIND_VALUES,
  JOB_STATUS_VALUES,
  LABOR_CLASS_KINDS,
  LINK_TARGET_TYPES,
  MATERIAL_METHOD_VALUES,
  PARTS_OWNER_VALUES,
  PLAN_KINDS,
  PLAN_LINE_CATEGORIES,
  PLAN_LINE_UNITS,
  PLAN_ORIGINS,
  PRICING_MODEL_VALUES,
  REVENUE_KINDS,
  SAVED_VIEW_PAGES,
  SHARED_COST_RULE_VALUES,
  SHARED_SPREAD_VALUES,
  STANDARD_BASIS_VALUES,
  TARGET_METRICS,
  TARGET_SCOPES,
  VAS_BILLING_VALUES,
} from '@/lib/constants';

export const uuid = z.guid('That id is not valid.');
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-17.').refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'That date does not exist.');
export const nullableDate = isoDate.nullable();
export const name = (max = 200) => z.string().trim().min(1, 'This cannot be empty.').max(max, `Keep this to ${max} characters or fewer.`);
export const text = (max = 2000) => z.string().max(max, `Keep this to ${max} characters or fewer.`);
export const code = z.string().trim().min(1).max(40, 'Keep the code to 40 characters or fewer.').regex(/^[^\s,;]+$/, 'A code cannot hold spaces or commas.');
export const version = z.number().int().positive().nullable().optional();

/** A number typed as text or number, kept as an exact decimal string with up to `scale` places. */
function decimal(scale: number, max: number, message: string) {
  const pattern = new RegExp(`^\\d{1,${String(max).length}}(\\.\\d{1,${scale}})?$`);
  return z
    .union([z.string(), z.number()])
    .transform((value) => (typeof value === 'number' ? (Number.isFinite(value) ? String(value) : 'x') : value.trim().replace(/,/g, '')))
    .refine((value) => pattern.test(value) && Number(value) < max, message);
}

/** Quantity: 0 or more, up to 3 decimal places, under 100,000,000. */
export const quantity = decimal(3, 100_000_000, 'Type a number of 0 or more with up to 3 decimal places.');
/** Labor hours: 0 or more, up to 2 decimal places. */
export const hours = decimal(2, 100_000_000, 'Type hours of 0 or more with up to 2 decimal places.');
/** People: 0 or more, up to 2 decimal places, under 10,000. */
export const headcount = decimal(2, 10_000, 'Type the number of people.');
/** A per unit price or cost in currency units: up to 4 decimal places, under 1,000,000. */
export const unitPrice = decimal(4, 1_000_000, 'Type a price of 0 or more with up to 4 decimal places.');
/** Units per person per hour: above 0, up to 3 decimal places. */
export const pace = decimal(3, 1_000_000_000, 'Type a pace above zero.').refine((value) => Number(value) > 0, 'Type a pace above zero.');
/** Whole cents. May be negative where the field allows it. */
export const cents = z.number().int('Money must be whole cents.').min(-10_000_000_000_000).max(10_000_000_000_000);
export const positiveCents = cents.min(0, 'This cannot be below zero.');
/** Cents per hour (a wage, a rate): 0 to $100,000.00. */
export const rateCents = z.number().int().min(0, 'This cannot be below zero.').max(10_000_000);
/** Basis points: 2500 is 25%. */
export const bp = z.number().int().min(-1_000_000).max(1_000_000);
export const positiveBp = z.number().int().min(0).max(100_000);
export const multiplier = decimal(2, 6, 'Type a multiplier from 1 to 5, like 1.5.').refine((value) => Number(value) >= 1 && Number(value) <= 5, 'Type a multiplier from 1 to 5, like 1.5.');
export const color = z.string().max(24).nullable();

export const jobStatus = z.enum(JOB_STATUS_VALUES);
export const jobKind = z.enum(JOB_KIND_VALUES);
export const pricingModel = z.enum(PRICING_MODEL_VALUES);
export const materialMethod = z.enum(MATERIAL_METHOD_VALUES);
export const partsOwner = z.enum(PARTS_OWNER_VALUES);
export const laborClassKind = z.enum(LABOR_CLASS_KINDS);
export const vasBilling = z.enum(VAS_BILLING_VALUES);
export const standardBasis = z.enum(STANDARD_BASIS_VALUES);
export const targetScope = z.enum(TARGET_SCOPES);
export const targetMetric = z.enum(TARGET_METRICS);
export const planKind = z.enum(PLAN_KINDS);
export const planOrigin = z.enum(PLAN_ORIGINS);
export const planLineCategory = z.enum(PLAN_LINE_CATEGORIES);
export const planLineUnit = z.enum(PLAN_LINE_UNITS);
export const linkTargetType = z.enum(LINK_TARGET_TYPES);
export const indirectReason = z.enum(INDIRECT_REASONS);
export const costCategory = z.enum(COST_CATEGORIES);
export const revenueKind = z.enum(REVENUE_KINDS);
export const alertKind = z.enum(ALERT_KINDS);
export const alertSeverity = z.enum(ALERT_SEVERITIES);
export const savedViewPage = z.enum(SAVED_VIEW_PAGES);
export const sharedCostRule = z.enum(SHARED_COST_RULE_VALUES);
export const sharedSpread = z.enum(SHARED_SPREAD_VALUES);
export const pulseRole = z.enum(['owner', 'admin', 'manager', 'supervisor', 'viewer', 'none']);

export const usualCrew = z.array(z.object({ laborClassId: uuid, headcount: z.number().min(0).max(9999) })).max(20);

export const planLine = z.object({
  category: planLineCategory,
  description: text(300).nullable().optional(),
  quantity: quantity.nullable().optional(),
  unit: planLineUnit.nullable().optional(),
  unitAmount: unitPrice.nullable().optional(),
  amountCents: cents,
  flex: z.boolean().nullable().optional(),
  laborClassId: uuid.nullable().optional(),
  vasServiceId: uuid.nullable().optional(),
  itemId: uuid.nullable().optional(),
});

export const planInput = z.object({
  units: quantity.optional(),
  revenueCents: cents.optional(),
  laborHours: hours.optional(),
  laborCents: positiveCents.optional(),
  setupHours: hours.optional(),
  setupCents: positiveCents.optional(),
  materialCents: positiveCents.optional(),
  otherCents: cents.optional(),
  sharedCents: positiveCents.nullable().optional(),
  lines: z.array(planLine).max(200).optional(),
  origin: planOrigin.optional(),
  originRef: text(200).nullable().optional(),
  note: text(2000).nullable().optional(),
  version,
});

export const jobLink = z.object({
  targetType: linkTargetType,
  targetId: z.string().trim().min(1).max(200),
  importsTime: z.boolean().optional(),
  title: text(300).nullable().optional(),
  status: text(80).nullable().optional(),
  url: z.string().max(500).regex(/^\/(?!\/)/, 'A link is a path that starts with one slash.').nullable().optional(),
});

/** The body of one production row (the grid autosave, the Work log form and the bulk paste). */
export const productionInput = z.object({
  id: uuid.nullable().optional(),
  jobId: uuid,
  workDate: isoDate,
  shift: z.string().trim().min(1).max(24).nullable().optional(),
  laborClassId: uuid.nullable().optional(),
  unitsGood: quantity.optional(),
  unitsScrap: quantity.optional(),
  unitsRework: quantity.optional(),
  headcount: headcount.nullable().optional(),
  hours: hours.optional(),
  overtimeHours: hours.optional(),
  setupHours: hours.optional(),
  hoursConfirmed: z.boolean().optional(),
  note: text(1000).nullable().optional(),
  version,
});
