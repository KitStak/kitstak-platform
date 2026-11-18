'use client';
/** The settings sections that are plain forms over the workspace settings: General, Labor defaults and Cost rules. */
import { useMemo } from 'react';
import { HandCoins } from 'lucide-react';
import { ButtonLink } from '@/components/pulse/button-link';
import { formatMoneyPerHour } from '@/lib/format';
import { loadedRate } from '@/lib/profit/rates';
import { routes } from '@/lib/routes';
import type { SettingsDTO } from '@/lib/types';
import { SettingsForm, type SettingsField } from '../settings-form';

const CURRENCIES: readonly [string, string][] = [
  ['USD', 'US dollar'],
  ['CAD', 'Canadian dollar'],
  ['MXN', 'Mexican peso'],
  ['EUR', 'Euro'],
  ['GBP', 'British pound'],
  ['AUD', 'Australian dollar'],
  ['NZD', 'New Zealand dollar'],
  ['CHF', 'Swiss franc'],
  ['SEK', 'Swedish krona'],
  ['NOK', 'Norwegian krone'],
  ['DKK', 'Danish krone'],
  ['PLN', 'Polish zloty'],
  ['JPY', 'Japanese yen'],
  ['INR', 'Indian rupee'],
  ['BRL', 'Brazilian real'],
  ['ZAR', 'South African rand'],
];

const FALLBACK_ZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu', 'America/Toronto', 'America/Vancouver', 'America/Mexico_City', 'Europe/London', 'Europe/Dublin', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Warsaw', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney', 'Pacific/Auckland', 'UTC'];

/** Every time zone the browser knows, with the stored one always in the list. */
export function timeZoneOptions(current?: string | null): { value: string; label: string }[] {
  let zones: string[] = FALLBACK_ZONES;
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone');
    if (supported && supported.length > 0) zones = supported;
  } catch {
    zones = FALLBACK_ZONES;
  }
  const all = current && !zones.includes(current) ? [current, ...zones] : zones;
  return all.map((zone) => ({ value: zone, label: zone.replace(/_/g, ' ') }));
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function GeneralSection({ settings, canEdit }: { readonly settings: SettingsDTO; readonly canEdit: boolean }) {
  const fields = useMemo<SettingsField[]>(
    () => [
      { kind: 'select', key: 'currency', label: 'Currency', hint: 'The money every amount in Pulse is in.', options: (CURRENCIES.some(([code]) => code === settings.currency) ? CURRENCIES : ([[settings.currency, settings.currency], ...CURRENCIES] as [string, string][])).map(([code, name]) => ({ value: code, label: `${code}, ${name}` })) },
      { kind: 'select', key: 'timezone', label: 'Company time zone', hint: 'Used for a new site and for "today" when a site has no time zone of its own.', options: timeZoneOptions(settings.timezone) },
      { kind: 'select', key: 'weekStart', numeric: true, label: 'Week starts on', hint: 'Weekly totals and the weekly spread of time not on a job follow this.', options: WEEKDAYS.map((label, index) => ({ value: String(index), label })) },
      { kind: 'select', key: 'fiscalYearStartMonth', numeric: true, label: 'Year starts in', hint: 'The first month of your business year, for "this year" totals.', options: MONTHS.map((label, index) => ({ value: String(index + 1), label })) },
      { kind: 'days', key: 'workingDays', label: 'Working days', hint: 'Days your floor usually runs. Projected finish dates and "nothing logged" alerts skip the other days.' },
      { kind: 'decimal', key: 'defaultShiftHours', min: 0.25, max: 24, suffix: 'hours', label: 'Length of a shift', hint: 'Fills in "hours each" on the log and sets daily goals.' },
      { kind: 'text', key: 'jobNumberPrefix', maxLength: 12, label: 'Job numbers start with', hint: 'New jobs are numbered with this in front, like J-1042.', placeholder: 'J-' },
      { kind: 'select', key: 'dateOrder', label: 'Dates like 3/4/2026 in files', hint: 'How imports read a date when the file itself does not make it clear.', options: [{ value: 'MDY', label: 'Month first: March 4' }, { value: 'DMY', label: 'Day first: April 3' }] },
    ],
    [settings.currency, settings.timezone],
  );
  return <SettingsForm testId="settings-general" title="General" intro="The basics of your company: money, calendar and how jobs are numbered." fields={fields} settings={settings} canEdit={canEdit} footnote="Changing the week start or the working days recalculates open months." />;
}

const LABOR_FIELDS: readonly SettingsField[] = [
  { kind: 'percent', key: 'defaultPayrollTaxBp', label: 'Payroll taxes and workers comp', hint: 'On top of the wage. Fills in a new labor rate.' },
  { kind: 'percent', key: 'defaultBenefitsBp', label: 'Benefits and paid time off', hint: 'On top of the wage.' },
  { kind: 'percent', key: 'defaultOtherBurdenBp', label: 'Other costs on the wage', hint: 'Anything else you pay per hour worked, as a percent of the wage.' },
  { kind: 'money', key: 'defaultOverheadPerHourCents', suffix: 'an hour', label: 'Overhead for each hour', hint: 'Rent, supervisors, equipment: the part of running the floor you want every labor hour to carry.' },
  { kind: 'decimal', key: 'defaultOvertimeMultiplier', min: 1, max: 5, suffix: 'x the wage', label: 'Overtime pays', hint: 'Usually 1.5.' },
  { kind: 'money', key: 'defaultLoadedRateCents', nullable: true, suffix: 'an hour', label: 'Real cost of an hour when no rate is set', hint: 'Used for hours whose labor class has no rate yet, so labor cost is never zero by accident. Leave it empty to flag those hours instead.' },
];

export function LaborDefaultsSection({ settings, canEdit }: { readonly settings: SettingsDTO; readonly canEdit: boolean }) {
  return (
    <SettingsForm
      testId="settings-labor"
      title="Labor defaults"
      intro="What Pulse fills in when you add a labor rate. Each labor class can have its own numbers on the Labor page."
      fields={LABOR_FIELDS}
      settings={settings}
      canEdit={canEdit}
      footnote="Changing the fallback rate or the overtime multiplier recalculates open months."
    >
      {(draft) => {
        let example: string | null = null;
        try {
          const number = (key: string): number => Math.round(Number(draft[key] || 0) * 100);
          const rate = loadedRate({ wageCents: 1600, payrollTaxBp: number('defaultPayrollTaxBp'), benefitsBp: number('defaultBenefitsBp'), otherBurdenBp: number('defaultOtherBurdenBp'), overheadPerHourCents: number('defaultOverheadPerHourCents'), overtimeMultiplier: draft.defaultOvertimeMultiplier || '1.5' });
          example = `With these numbers, a $16.00 wage really costs ${formatMoneyPerHour(Number(rate.loadedRateCents))}, and ${formatMoneyPerHour(Number(rate.overtimeRateCents))} in overtime.`;
        } catch {
          example = null;
        }
        return (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border-subtle bg-sunken px-3 py-2.5" data-testid="labor-example">
            <p className="flex min-w-0 flex-1 items-start gap-2 text-sm text-fg-secondary">
              <HandCoins aria-hidden className="mt-0.5 size-4 shrink-0 text-icon-strong" />
              <span>{example ?? 'Type numbers above to see what an hour would really cost.'}</span>
            </p>
            <ButtonLink href={routes.labor('rates')} variant="secondary" size="sm">
              Open labor rates
            </ButtonLink>
          </div>
        );
      }}
    </SettingsForm>
  );
}

const COST_FIELDS: readonly SettingsField[] = [
  { kind: 'select', key: 'defaultPartsOwner', label: 'Who buys the parts', hint: 'The usual answer. A client, a job or one material row can say otherwise.', options: [{ value: 'us', label: 'We do. Parts are our cost' }, { value: 'client', label: 'The client does. Parts cost us nothing' }] },
  { kind: 'percent', key: 'defaultTargetMarginBp', label: 'Target margin', hint: 'The margin you aim for when a client or job type has no target of its own.' },
  {
    kind: 'select',
    key: 'sharedCostRule',
    label: 'Time not on a job',
    hint: 'Meetings, cleanup and waiting are real costs. This says which jobs carry them.',
    options: [
      { value: 'by_labor_hours', label: 'Spread by labor hours', description: 'Jobs share it by the hours they used.' },
      { value: 'full', label: 'Spread everything, with paid time nobody logged', description: 'Also spreads paid hours that are on no job and no reason.' },
      { value: 'percent_of_labor', label: 'A fixed percent of labor', description: 'Each job carries a set percent on top of its labor.' },
      { value: 'none', label: 'Keep it off the jobs', description: 'It shows only in company profit.' },
    ],
  },
  { kind: 'percent', key: 'sharedPctBp', max: 1000, label: 'Percent on top of labor', hint: 'Each job carries this share of its own labor cost.', when: (draft) => draft.sharedCostRule === 'percent_of_labor' },
  { kind: 'select', key: 'sharedSpread', label: 'Spread it over', hint: 'A slow day is shared with the busy days of the same period.', when: (draft) => draft.sharedCostRule === 'by_labor_hours' || draft.sharedCostRule === 'full', options: [{ value: 'day', label: 'Each day' }, { value: 'week', label: 'Each week' }, { value: 'month', label: 'Each month' }] },
  { kind: 'percent', key: 'marginFloorBp', label: 'Losing money when margin is heading under', hint: 'A job whose projected margin falls below this is marked losing money. Most shops use 0 to 10.' },
  { kind: 'percent', key: 'atRiskGapBp', label: 'At risk when this far under the target', hint: 'Points of margin below the target that make a job at risk.' },
  { kind: 'percent', key: 'laborWatchOverBp', max: 1000, label: 'Heads up when labor runs over plan by', hint: 'Labor hours over the plan, for the work done so far.' },
  { kind: 'percent', key: 'laborRiskOverBp', max: 1000, label: 'At risk when labor runs over plan by' },
  { kind: 'percent', key: 'productivityWatchBp', max: 1000, label: 'Heads up when pace is under', hint: 'Percent of the target pace.' },
  { kind: 'percent', key: 'productivityRiskBp', max: 1000, label: 'At risk when pace is under', hint: 'Percent of the target pace.' },
  { kind: 'percent', key: 'materialWatchOverBp', max: 1000, label: 'Heads up when materials run over plan by' },
  { kind: 'whole', key: 'noEntryDays', min: 1, max: 60, suffix: 'work days', label: 'Nothing logged for', hint: 'An active job with no entries for this many work days gets a heads up.' },
  { kind: 'money', key: 'unbilledAlertCents', label: 'Tell me when work not billed yet passes', hint: 'Earned on finished work, with no invoice against it.' },
  { kind: 'whole', key: 'unbilledAlertDays', min: 0, max: 365, suffix: 'days', label: 'And it has waited' },
];

export function CostRulesSection({ settings, canEdit }: { readonly settings: SettingsDTO; readonly canEdit: boolean }) {
  return (
    <SettingsForm
      testId="settings-cost-rules"
      title="Cost rules"
      intro="How costs land on jobs and when a job counts as needing a heads up, at risk or losing money."
      fields={COST_FIELDS}
      settings={settings}
      canEdit={canEdit}
      footnote="Saving a cost rule or a limit recalculates every open month and checks every job again. Closed months do not move."
    />
  );
}
