/**
 * The L2 fixture program (docs/programs/SPEC.md 10.2): a small glove program built only through
 * the program domain, so UI layers have real rows to render before the L7 seed lands, and db
 * tests share one setup. Eight variants (Small, Medium, Large, XL by Brown, Yellow), a card of
 * $1.95 per kit with "Size is XL: add $0.25", a $500 monthly fee, a $3,000 minimum, a $250 setup
 * fee and a weekday schedule of 100 per variant with a 7 day lead.
 */
import 'server-only';
import type { ProgramWizardPayload } from '@/lib/program-types';
import type { DomainContext } from '../_shared';
import { createProgram, type CreateProgramResult } from './programs';

export const FIXTURE_SIZES = [
  { id: 'size-s', label: 'Small', code: 'S' },
  { id: 'size-m', label: 'Medium', code: 'M' },
  { id: 'size-l', label: 'Large', code: 'L' },
  { id: 'size-xl', label: 'XL', code: 'XL' },
] as const;
export const FIXTURE_COLORS = [
  { id: 'color-br', label: 'Brown', code: 'BR' },
  { id: 'color-ye', label: 'Yellow', code: 'YE' },
] as const;

export function fixturePayload(input: { readonly key: string; readonly name: string; readonly ownerId: string; readonly startDate: string; readonly timezone?: string; readonly scheduleQty?: string; readonly withSchedule?: boolean }): ProgramWizardPayload {
  const rows = FIXTURE_SIZES.flatMap((size) =>
    FIXTURE_COLORS.map((color) => ({
      comboKey: `axis-size=${size.id}|axis-color=${color.id}`,
      include: true,
      name: `${size.label} ${color.label}`,
      key: `${size.code}-${color.code}`,
      sku: `${input.key}-${size.code}-${color.code}`,
      defaultQty: '100',
      unitPrice: null,
    })),
  );
  return {
    start: { mode: 'scratch' },
    basics: {
      name: input.name,
      key: input.key,
      description: 'Glove kits for the Gripwell account.',
      customer: null,
      ownerId: input.ownerId,
      startDate: input.startDate,
      endDate: null,
      unit: { singular: 'kit', plural: 'kits' },
      timezone: input.timezone ?? 'America/Chicago',
      calendar: { useWorkspace: true, workingDays: null, extraDaysOff: [], extraWorkDays: [] },
      color: 'amber',
      icon: 'repeat',
      monthlyTargetCents: '1500000',
    },
    variants: {
      mode: 'matrix',
      axes: [
        { id: 'axis-size', name: 'Size', values: FIXTURE_SIZES.map((v) => ({ ...v, color: null })) },
        { id: 'axis-color', name: 'Color', values: FIXTURE_COLORS.map((v) => ({ ...v, color: null })) },
      ],
      patterns: { name: '{Size} {Color}', key: '{Size.code}-{Color.code}', sku: '{program}-{Size.code}-{Color.code}' },
      rows,
      manual: [],
    },
    priceCard: {
      later: false,
      effectiveFrom: input.startDate,
      lines: [
        { kind: 'per_unit', variantKey: null, unitPrice: '1.9500' },
        { kind: 'flat_monthly', amountCents: '50000', prorate: true, chargeWhilePaused: true },
        { kind: 'monthly_minimum', amountCents: '300000', prorate: true, chargeWhilePaused: true },
      ],
      rules: [{ attributeId: 'Size', valueId: 'XL', op: 'add', amount: '0.25' }],
      oneTime: [{ label: 'Setup fee', amountCents: '25000', chargeOn: input.startDate }],
    },
    schedule: {
      enabled: input.withSchedule !== false,
      name: 'Weekday glove run',
      pattern: 'weekdays',
      days: [],
      intervalWeeks: 1,
      startsOn: input.startDate,
      endsOn: null,
      leadDays: 7,
      lines: rows.map((row) => ({ variantKey: row.key, qty: input.scheduleQty ?? '100' })),
    },
    links: { crmDealId: null, crmAccountId: null, pulseJobId: null, projectIds: [], members: [] },
  };
}

export async function createFixtureProgram(ctx: DomainContext, input: { readonly key: string; readonly name?: string; readonly startDate: string; readonly withSchedule?: boolean }): Promise<CreateProgramResult> {
  return createProgram(ctx, fixturePayload({ key: input.key, name: input.name ?? 'Glove kits', ownerId: ctx.userId, startDate: input.startDate, withSchedule: input.withSchedule }));
}
