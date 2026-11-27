'use server';
/** Production team actions: device links, kiosk PINs and time punches. */
import { z } from 'zod';
import {
  createDeviceLink,
  deletePunches,
  renewDeviceLink,
  restorePunches,
  revokeDeviceLink,
  savePunches,
  setMyKioskPin,
  updateDeviceLink,
} from '@/server/domain';
import { runAction } from './_action';
import { hours, indirectReason, isoDate, name, positiveCents, uuid, version } from './schemas';

const createLinkSchema = z.object({
  kind: z.enum(['kiosk', 'wall']),
  name: name(80),
  siteId: uuid.nullable().optional(),
  expiresInDays: z.number().int().min(1).max(365).nullable().optional(),
  config: z.record(z.string(), z.unknown()).nullable().optional(),
});
/** Makes a device link. The answer holds the secret path once: show it, then forget it. */
export async function createDeviceLinkAction(input: z.input<typeof createLinkSchema>) {
  return runAction(createLinkSchema, input, (data, ctx) => createDeviceLink(ctx, data), {
    revalidate: false,
  });
}

const linkIdSchema = z.object({ linkId: uuid });
/** Turns a device link off. Pair with `renewDeviceLinkAction` for undo. */
export async function revokeDeviceLinkAction(input: z.input<typeof linkIdSchema>) {
  return runAction(linkIdSchema, input, (data, ctx) => revokeDeviceLink(ctx, data.linkId), {
    revalidate: false,
  });
}

const renewSchema = z.object({
  linkId: uuid,
  expiresInDays: z.number().int().min(1).max(365).nullable().optional(),
});
/** Turns a link back on, or gives it more days. */
export async function renewDeviceLinkAction(input: z.input<typeof renewSchema>) {
  return runAction(
    renewSchema,
    input,
    (data, ctx) => renewDeviceLink(ctx, data.linkId, { expiresInDays: data.expiresInDays }),
    { revalidate: false },
  );
}

const updateLinkSchema = z.object({
  linkId: uuid,
  patch: z.object({ name: name(80).optional(), config: z.record(z.string(), z.unknown()).optional() }),
});
export async function updateDeviceLinkAction(input: z.input<typeof updateLinkSchema>) {
  return runAction(updateLinkSchema, input, (data, ctx) => updateDeviceLink(ctx, data.linkId, data.patch), {
    revalidate: false,
  });
}

const myPinSchema = z.object({
  pin: z
    .string()
    .regex(/^\d{4}$/, 'Type 4 digits.')
    .nullable(),
});
/** Sets or clears the signed in person's own kiosk PIN. */
export async function setMyKioskPinAction(input: z.input<typeof myPinSchema>) {
  return runAction(myPinSchema, input, (data, ctx) => setMyKioskPin(ctx, data.pin), { revalidate: false });
}

const punchSchema = z.object({
  id: uuid.nullable().optional(),
  siteId: uuid.nullable().optional(),
  workDate: isoDate,
  employeeCode: z.string().trim().min(1, 'Type the employee id.').max(60),
  employeeName: z.string().trim().max(120).nullable().optional(),
  jobRef: z.string().trim().max(80).nullable().optional(),
  reason: indirectReason.nullable().optional(),
  laborClassId: uuid.nullable().optional(),
  hours,
  overtimeHours: hours.optional(),
  payCents: positiveCents.nullable().optional(),
  version,
});
const punchesSchema = z.object({ punches: z.array(punchSchema).min(1).max(5000) });
export type SavePunchesActionInput = z.input<typeof punchesSchema>;
/** Saves time punches and rebuilds the hours they own. All or nothing. */
export async function savePunchesAction(input: SavePunchesActionInput) {
  return runAction(punchesSchema, input, (data, ctx) => savePunches(ctx, data.punches));
}

const idsSchema = z.object({ ids: z.array(uuid).min(1).max(2000) });
export async function deletePunchesAction(input: z.input<typeof idsSchema>) {
  return runAction(idsSchema, input, (data, ctx) => deletePunches(ctx, data.ids));
}
export async function restorePunchesAction(input: z.input<typeof idsSchema>) {
  return runAction(idsSchema, input, (data, ctx) => restorePunches(ctx, data.ids));
}
