'use server';
/** People actions (docs/crew/SPEC.md 6.1 `/people`, `/people/new`, `/people/[id]`). The domain checks every right. */
import { z } from 'zod';
import {
  bulkUpdatePeople,
  createPerson,
  issuePinSlips,
  removePerson,
  removeWage,
  setBadge,
  setPersonPay,
  setPersonPrivate,
  setWage,
  updatePerson,
} from '@/server/domain/people';
import { LANGUAGES, PAY_TYPES, PERSON_KINDS, PERSON_STATUSES } from '@/lib/csv/people';
import { runAction } from './_action';

const text = (max: number) => z.string().trim().max(max).nullable().optional();
const id = z.string().uuid();
const optionalId = id.nullable().optional();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-03.').nullable().optional().or(z.literal(''));

const personSchema = z.object({
  number: text(40),
  firstName: z.string().trim().min(1, 'Type a first name.').max(80),
  lastName: z.string().trim().min(1, 'Type a last name.').max(80),
  preferredName: text(80),
  kind: z.enum(PERSON_KINDS),
  status: z.enum(PERSON_STATUSES),
  homeSiteId: optionalId,
  usualAreaId: optionalId,
  laborClassId: optionalId,
  leadPersonId: optionalId,
  agencyVendorId: optionalId,
  agencyRef: text(80),
  startDate: date,
  endDate: date,
  language: z.enum(LANGUAGES),
  email: text(254),
  phone: text(40),
  notes: text(2000),
  userId: optionalId,
  notifyEmail: z.boolean().optional(),
  badge: text(120),
});

const privateSchema = z.object({
  emergencyName: text(120),
  emergencyPhone: text(40),
  emergencyRelation: text(80),
  privateNotes: text(2000),
});

const paySchema = z.object({
  payType: z.enum(PAY_TYPES).optional(),
  overtimeExempt: z.boolean().optional(),
  wageCents: z.number().int().min(0).max(1_000_000).nullable().optional(),
});

const createSchema = z.object({ person: personSchema, private: privateSchema.optional(), pay: paySchema.optional() });

export async function createPersonAction(input: z.input<typeof createSchema>) {
  return runAction(createSchema, input, (data, ctx) =>
    createPerson(ctx, { ...data.person, startDate: data.person.startDate || null, endDate: data.person.endDate || null, badge: data.person.badge || undefined }, { private: data.private, pay: data.pay }),
  );
}

const updateSchema = z.object({ personId: id, version: z.number().int().min(1), person: personSchema.omit({ badge: true }), private: privateSchema.optional() });

export async function updatePersonAction(input: z.input<typeof updateSchema>) {
  return runAction(updateSchema, input, (data, ctx) =>
    updatePerson(ctx, data.personId, data.version, { ...data.person, startDate: data.person.startDate || null, endDate: data.person.endDate || null }, { private: data.private }),
  );
}

const privateOnlySchema = z.object({ personId: id, private: privateSchema });
export async function setPersonPrivateAction(input: z.input<typeof privateOnlySchema>) {
  return runAction(privateOnlySchema, input, (data, ctx) => setPersonPrivate(ctx, data.personId, data.private));
}

const payOnlySchema = z.object({ personId: id, payType: z.enum(PAY_TYPES).optional(), overtimeExempt: z.boolean().optional() });
export async function setPersonPayAction(input: z.input<typeof payOnlySchema>) {
  return runAction(payOnlySchema, input, (data, ctx) => setPersonPay(ctx, data.personId, { payType: data.payType, overtimeExempt: data.overtimeExempt }));
}

const wageSchema = z.object({ personId: id, effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), wageCents: z.number().int().min(0).max(1_000_000), note: text(200) });
export async function setWageAction(input: z.input<typeof wageSchema>) {
  return runAction(wageSchema, input, (data, ctx) => setWage(ctx, data.personId, data));
}

const removeWageSchema = z.object({ personId: id, wageId: id });
export async function removeWageAction(input: z.input<typeof removeWageSchema>) {
  return runAction(removeWageSchema, input, (data, ctx) => removeWage(ctx, data.personId, data.wageId));
}

const idsSchema = z.object({ personIds: z.array(id).min(1).max(500) });

/** New starting PINs, shown once for the print view. Not revalidated: the page keeps showing the slips. */
export async function issuePinSlipsAction(input: z.input<typeof idsSchema>) {
  return runAction(idsSchema, input, (data, ctx) => issuePinSlips(ctx, data.personIds), { revalidate: false });
}

const badgeSchema = z.object({ personId: id, badge: z.string().trim().max(120).nullable() });
export async function setBadgeAction(input: z.input<typeof badgeSchema>) {
  return runAction(badgeSchema, input, (data, ctx) => setBadge(ctx, data.personId, data.badge || null));
}

const removeSchema = z.object({ personId: id });
export async function removePersonAction(input: z.input<typeof removeSchema>) {
  return runAction(removeSchema, input, (data, ctx) => removePerson(ctx, data.personId));
}

const bulkSchema = z.object({
  personIds: z.array(id).min(1).max(500),
  patch: z.object({ homeSiteId: id.optional(), leadPersonId: id.nullable().optional(), status: z.enum(PERSON_STATUSES).optional(), endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() }),
});
export async function bulkUpdatePeopleAction(input: z.input<typeof bulkSchema>) {
  return runAction(bulkSchema, input, (data, ctx) => bulkUpdatePeople(ctx, data.personIds, data.patch));
}
