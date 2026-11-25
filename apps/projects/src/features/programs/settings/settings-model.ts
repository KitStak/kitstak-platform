/**
 * Pure helpers for the program Settings tab (docs/programs/SPEC.md 5.16): the build title preview
 * (the same tokens the server uses), the months shown under Month close, and which sections show.
 */
import { monthOf, shiftMonth, shortDate } from '@kitstak/programs-engine';
import type { IsoDate, IsoMonth, UnitLabel } from '@/lib/program-types';

/**
 * The title a build would get: `{variant}`, `{date}`, `{qty}`, `{program}` and `{sku}`, with an
 * example variant ("Small Brown · Nov 25").
 */
export function buildTitlePreview(pattern: string, sample: { readonly programKey: string; readonly unit: UnitLabel; readonly date?: IsoDate }): string {
  const date = sample.date ?? '2026-11-25';
  const text = (pattern || '{variant} · {date}')
    .replaceAll('{variant}', 'Small Brown')
    .replaceAll('{date}', shortDate(date))
    .replaceAll('{qty}', '100')
    .replaceAll('{program}', sample.programKey)
    .replaceAll('{sku}', `${sample.programKey}-S-BR`)
    .replace(/\s+/g, ' ')
    .replace(/^[\s·]+|[\s·]+$/g, '')
    .trim();
  return text || `Build · ${shortDate(date)}`;
}

/** Months from the program start through this month, newest first (at most 24). */
export function closeMonthsFor(startDate: IsoDate | null, today: IsoDate): IsoMonth[] {
  if (!startDate || startDate > today) return [];
  const out: IsoMonth[] = [];
  for (let month = monthOf(today); month >= monthOf(startDate) && out.length < 24; month = shiftMonth(month, -1)) out.push(month);
  return out;
}

export interface SettingsSectionLink {
  readonly id: string;
  readonly label: string;
}

/** The sections this person sees, in page order. */
export function settingsSectionsFor(input: { readonly canManage: boolean; readonly seesSync: boolean; readonly moneyHidden: boolean; readonly hasPulseJob: boolean }): SettingsSectionLink[] {
  const out: SettingsSectionLink[] = [
    { id: 'general', label: 'General' },
    { id: 'units', label: 'Units and calendar' },
  ];
  if (!input.moneyHidden) out.push({ id: 'money', label: 'Money' }, { id: 'close', label: 'Month close' });
  out.push({ id: 'people', label: 'People' });
  if (input.hasPulseJob && input.seesSync && !input.moneyHidden) out.push({ id: 'pulse', label: 'Pulse check' });
  if (input.canManage) out.push({ id: 'danger', label: 'Danger zone' });
  return out;
}
