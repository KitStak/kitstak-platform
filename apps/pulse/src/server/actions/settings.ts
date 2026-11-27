'use server';
import { z } from 'zod';
import { claimPulseOwnership, clearMemberRole, createSite, deleteSite, setKioskPin, setMemberRole, setOnboarding, updateSettings, updateSite } from '@/server/domain';
import { runAction } from './_action';
import { bp, code, hours, multiplier, name, partsOwner, positiveBp, positiveCents, pulseRole, rateCents, sharedCostRule, sharedSpread, uuid } from './schemas';

const settingsSchema = z
  .object({
    currency: z.string().regex(/^[A-Z]{3}$/, 'Use a 3 letter currency code, like USD.'),
    timezone: z.string().min(1).max(64),
    weekStart: z.number().int().min(0).max(6),
    fiscalYearStartMonth: z.number().int().min(1).max(12),
    workingDays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    defaultShiftHours: hours.refine((value) => Number(value) > 0 && Number(value) <= 24, 'A shift is more than 0 and up to 24 hours.'),
    defaultPayrollTaxBp: positiveBp,
    defaultBenefitsBp: positiveBp,
    defaultOtherBurdenBp: positiveBp,
    defaultOverheadPerHourCents: rateCents,
    defaultOvertimeMultiplier: multiplier,
    defaultLoadedRateCents: rateCents.nullable(),
    defaultTargetMarginBp: bp,
    marginFloorBp: bp,
    atRiskGapBp: positiveBp,
    laborWatchOverBp: positiveBp,
    laborRiskOverBp: positiveBp,
    productivityWatchBp: positiveBp,
    productivityRiskBp: positiveBp,
    materialWatchOverBp: positiveBp,
    noEntryDays: z.number().int().min(1).max(60),
    unbilledAlertCents: positiveCents,
    unbilledAlertDays: z.number().int().min(0).max(365),
    sharedCostRule,
    sharedPctBp: positiveBp,
    sharedSpread,
    companyCostSpread: z.enum(['calendar', 'work_days']),
    defaultPartsOwner: partsOwner,
    defaultMemberRole: z.enum(['manager', 'supervisor', 'viewer', 'none']),
    jobNumberPrefix: z.string().max(12),
    dateOrder: z.enum(['MDY', 'DMY']),
    wmsAutoCreateJobs: z.boolean(),
    wmsSyncMaterials: z.boolean(),
    wmsSyncVas: z.boolean(),
    wmsSyncBilling: z.boolean(),
    wmsContractPrices: z.boolean(),
    wmsBillingOpsInProfit: z.array(z.string().max(60)).max(20),
    crmSuggestJobs: z.boolean(),
    projectsTimeImport: z.boolean(),
  })
  .partial();
export type UpdateSettingsActionInput = z.input<typeof settingsSchema>;
/** Saves org settings. A change to a cost rule, a default rate or a threshold recalculates every open month. */
export async function updateSettingsAction(input: UpdateSettingsActionInput) {
  return runAction(settingsSchema, input, (data, ctx) => updateSettings(ctx, data));
}

const onboardingSchema = z.object({ key: z.string().regex(/^[a-z][a-zA-Z0-9_]{0,40}$/), value: z.union([z.boolean(), z.string().max(200), z.number(), z.null()]).optional() });
/** Marks a welcome or checklist step (for example the browser time zone, or "added a client"). */
export async function setOnboardingAction(input: z.input<typeof onboardingSchema>) {
  return runAction(onboardingSchema, input, (data, ctx) => setOnboarding(ctx, data.key, data.value ?? true), { revalidate: false, read: true });
}

const siteFields = { code: code.nullable().optional(), name: name(120), timezone: z.string().min(1).max(64), isDefault: z.boolean().optional() };
const createSiteSchema = z.object(siteFields);
export async function createSiteAction(input: z.input<typeof createSiteSchema>) {
  return runAction(createSiteSchema, input, (data, ctx) => createSite(ctx, data));
}

const updateSiteSchema = z.object({ siteId: uuid, patch: z.object({ ...siteFields, archived: z.boolean() }).partial() });
export async function updateSiteAction(input: z.input<typeof updateSiteSchema>) {
  return runAction(updateSiteSchema, input, (data, ctx) => updateSite(ctx, data.siteId, data.patch));
}

const siteIdSchema = z.object({ siteId: uuid });
export async function deleteSiteAction(input: z.input<typeof siteIdSchema>) {
  return runAction(siteIdSchema, input, (data, ctx) => deleteSite(ctx, data.siteId));
}

const roleSchema = z.object({ userId: uuid, role: pulseRole.optional(), seesMoney: z.boolean().optional() });
/** Sets a person's Pulse role and the "sees money" switch. */
export async function setMemberRoleAction(input: z.input<typeof roleSchema>) {
  return runAction(roleSchema, input, (data, ctx) => setMemberRole(ctx, data.userId, { role: data.role, seesMoney: data.seesMoney }));
}

const userIdSchema = z.object({ userId: uuid });
/** Removes the explicit role, so the person follows the warehouse or the org role again. */
export async function clearMemberRoleAction(input: z.input<typeof userIdSchema>) {
  return runAction(userIdSchema, input, (data, ctx) => clearMemberRole(ctx, data.userId));
}

const emptySchema = z.object({}).optional();
/** "Run Pulse for this workspace". */
export async function claimPulseOwnershipAction() {
  return runAction(emptySchema, {}, (_data, ctx) => claimPulseOwnership(ctx));
}

const pinSchema = z.object({ userId: uuid, pin: z.string().regex(/^\d{4}$/, 'Type 4 digits.').nullable() });
export async function setKioskPinAction(input: z.input<typeof pinSchema>) {
  return runAction(pinSchema, input, (data, ctx) => setKioskPin(ctx, data.userId, data.pin), { revalidate: false });
}
