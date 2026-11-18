'use client';
/**
 * "Build on a schedule": pick how often, at what hour, which days each build covers and who is
 * told. Pulse builds the report on time, keeps the CSV and a page to print, and tells the people
 * picked here inside Pulse. It does not send email.
 */
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/checkbox';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { toast } from '@/components/ui/toast';
import { UserPicker } from '@/components/ui/user-picker';
import { useServerAction } from '@/lib/hooks/use-action';
import { usePeople } from '@/lib/hooks/use-data';
import { qk } from '@/lib/query-keys';
import { REPORTS, SCHEDULE_CADENCES, SCHEDULE_RANGES, SCHEDULE_RANGE_LABELS, WEEKDAY_LABELS, reportInfo, scheduleSentence, type ScheduleCadence, type ScheduleRange } from '@/lib/reports';
import type { ReportScheduleDTO } from '@/lib/types';
import { saveReportScheduleAction } from '@/server/actions/reports';
import { useShell } from '@/features/shell/shell-context';

export interface ScheduleFilters {
  readonly siteId?: string | null;
  readonly clientId?: string | null;
  readonly jobTypeId?: string | null;
  /** The filters in words, shown so the person knows what the build will cover. */
  readonly words?: string;
}

interface FormState {
  name: string;
  report: string;
  cadence: ScheduleCadence;
  weekday: number;
  dayOfMonth: number;
  hour: number;
  range: ScheduleRange;
  recipients: string[];
  includeMoney: boolean;
}

const CADENCE_LABELS: Readonly<Record<ScheduleCadence, string>> = { daily: 'Every day', weekly: 'Every week', monthly: 'Every month' };
const DEFAULT_RANGE: Readonly<Record<ScheduleCadence, ScheduleRange>> = { daily: 'yesterday', weekly: 'last_week', monthly: 'last_month' };
const hourLabel = (hour: number): string => `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? 'AM' : 'PM'}`;

interface ScheduleDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly schedule?: ReportScheduleDTO | null;
  readonly reportSlug?: string;
  readonly filters?: ScheduleFilters;
  readonly onSaved?: (schedule: ReportScheduleDTO) => void;
}

/** The dialog shell. The form inside is mounted fresh each time it opens. */
export function ScheduleDialog(props: ScheduleDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent size="md" data-testid="schedule-dialog">
        {props.open ? <ScheduleForm key={props.schedule?.id ?? props.reportSlug ?? 'new'} {...props} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function initialForm(schedule: ReportScheduleDTO | null | undefined, reportSlug: string | undefined, userId: string, seesMoney: boolean): FormState {
  if (schedule) {
    const config = schedule.config as { range?: string };
    return { name: schedule.name, report: schedule.report, cadence: schedule.cadence, weekday: schedule.weekday ?? 1, dayOfMonth: schedule.dayOfMonth ?? 1, hour: schedule.hour, range: (SCHEDULE_RANGES as readonly string[]).includes(config.range ?? '') ? (config.range as ScheduleRange) : 'last_week', recipients: [...schedule.recipientUserIds], includeMoney: schedule.includeMoney };
  }
  const slug = reportSlug ?? 'job-profit';
  return { name: `${reportInfo(slug)?.name ?? 'Report'}, every week`, report: slug, cadence: 'weekly', weekday: 1, dayOfMonth: 1, hour: 7, range: 'last_week', recipients: [userId], includeMoney: seesMoney };
}

function ScheduleForm({ onOpenChange, schedule, reportSlug, filters, onSaved }: ScheduleDialogProps) {
  const { user, seesMoney } = useShell();
  const people = usePeople();
  const [serverError, setServerError] = useState<string | null>(null);
  const save = useServerAction(saveReportScheduleAction, { invalidate: [qk.reportSchedules()], silentError: true, onError: (failure) => setServerError(failure.message) });
  const [form, setForm] = useState<FormState>(() => initialForm(schedule, reportSlug, user.id, seesMoney));
  const [touched, setTouched] = useState(false);

  const info = reportInfo(form.report);
  const needsMoney = Boolean(info?.needsMoney);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));
  const nameError = touched && form.name.trim().length === 0 ? 'Give the schedule a name.' : null;
  const sentence = useMemo(() => scheduleSentence({ cadence: form.cadence, weekday: form.weekday, dayOfMonth: form.dayOfMonth, hour: form.hour }), [form.cadence, form.weekday, form.dayOfMonth, form.hour]);
  const config = (schedule?.config ?? {}) as { siteId?: string | null; clientId?: string | null; jobTypeId?: string | null };
  const scope = filters ?? config;
  const reports = REPORTS.filter((report) => seesMoney || !report.needsMoney);

  const submit = async () => {
    setTouched(true);
    setServerError(null);
    if (form.name.trim().length === 0) return;
    const saved = await save.run({ id: schedule?.id ?? null, name: form.name.trim(), report: form.report, cadence: form.cadence, weekday: form.cadence === 'weekly' ? form.weekday : null, dayOfMonth: form.cadence === 'monthly' ? form.dayOfMonth : null, hour: form.hour, range: form.range, siteId: scope.siteId ?? null, clientId: scope.clientId ?? null, jobTypeId: scope.jobTypeId ?? null, recipientUserIds: form.recipients, includeMoney: needsMoney || form.includeMoney, enabled: schedule?.enabled ?? true });
    if (!saved) return;
    toast.success(schedule ? `Saved ${saved.name}` : `${saved.name} is scheduled`, `${sentence}. You will be told in Pulse when a build is ready.`);
    onSaved?.(saved);
    onOpenChange(false);
  };

  return (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader title={schedule ? 'Edit the schedule' : 'Build on a schedule'} description="Pulse builds the report for you and tells the people you pick, inside Pulse. No email is sent." />
          <DialogBody className="flex flex-col gap-4">
            <Field label="Name" required error={nameError ?? save.fieldErrors.name ?? null}>
              {({ inputId, describedBy, invalid }) => <Input id={inputId} aria-describedby={describedBy} invalid={invalid} value={form.name} onChange={(event) => set('name', event.target.value)} maxLength={80} autoFocus data-testid="schedule-name" />}
            </Field>
            {reportSlug && !schedule ? null : (
              <Field label="Report">
                {({ inputId }) => <Select id={inputId} value={form.report} onValueChange={(value) => set('report', value)} options={reports.map((report) => ({ value: report.slug, label: report.name }))} />}
              </Field>
            )}
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="How often">
                {({ inputId }) => (
                  <Select
                    id={inputId}
                    aria-label="How often"
                    value={form.cadence}
                    onValueChange={(value) => setForm((current) => ({ ...current, cadence: value as ScheduleCadence, range: DEFAULT_RANGE[value as ScheduleCadence] }))}
                    options={SCHEDULE_CADENCES.map((value) => ({ value, label: CADENCE_LABELS[value] }))}
                  />
                )}
              </Field>
              {form.cadence === 'weekly' ? (
                <Field label="On">{({ inputId }) => <Select id={inputId} aria-label="Day of the week" value={String(form.weekday)} onValueChange={(value) => set('weekday', Number(value))} options={WEEKDAY_LABELS.map((label, index) => ({ value: String(index), label }))} />}</Field>
              ) : form.cadence === 'monthly' ? (
                <Field label="On day">{({ inputId }) => <Select id={inputId} aria-label="Day of the month" value={String(form.dayOfMonth)} onValueChange={(value) => set('dayOfMonth', Number(value))} options={Array.from({ length: 31 }, (_, index) => ({ value: String(index + 1), label: String(index + 1) }))} />}</Field>
              ) : null}
              <Field label="At">{({ inputId }) => <Select id={inputId} aria-label="Hour of the day" value={String(form.hour)} onValueChange={(value) => set('hour', Number(value))} options={Array.from({ length: 24 }, (_, hour) => ({ value: String(hour), label: hourLabel(hour) }))} />}</Field>
            </div>
            <Field label="Each build covers" hint={scope.siteId || scope.clientId || scope.jobTypeId ? `Keeps the filters ${filters?.words ? `on screen: ${filters.words}` : 'it was saved with'}.` : 'All sites, clients and job types.'}>
              {({ inputId, describedBy }) => <Select id={inputId} aria-describedby={describedBy} value={form.range} onValueChange={(value) => set('range', value as ScheduleRange)} options={SCHEDULE_RANGES.map((value) => ({ value, label: SCHEDULE_RANGE_LABELS[value] }))} />}
            </Field>
            <Field label="Who is told" hint="They get a note in Pulse with a link to the files.">
              {() => <UserPicker multiple people={people.data ?? []} meId={user.id} value={form.recipients} onChange={(ids) => set('recipients', ids.length > 0 ? ids : [user.id])} aria-label="Who is told" placeholder="Pick people" />}
            </Field>
            {seesMoney ? (
              <Switch
                checked={needsMoney || form.includeMoney}
                disabled={needsMoney}
                onCheckedChange={(value) => set('includeMoney', value)}
                label="Include money"
                description={needsMoney ? 'This report is about money, so its builds always hold money. Only people who may see money can open them.' : 'Off: money columns are left blank in the build, so anyone on the list can open it.'}
              />
            ) : null}
            <p className="rounded-lg border border-border-subtle bg-sunken px-3 py-2 text-sm text-fg-secondary" data-testid="schedule-sentence" aria-live="polite">
              {sentence}, in the time zone of your site. Each build covers {SCHEDULE_RANGE_LABELS[form.range].toLowerCase()}. Builds are kept for 90 days.
            </p>
            {serverError ? (
              <p role="alert" className="text-sm text-danger-text" data-testid="schedule-error">
                {serverError}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={save.pending} data-testid="schedule-save">
              {schedule ? 'Save changes' : 'Save schedule'}
            </Button>
          </DialogFooter>
        </form>
  );
}
