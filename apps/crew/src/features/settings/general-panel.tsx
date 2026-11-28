'use client';
import { useState } from 'react';
import { Panel } from '@/components/layout/page';
import { Button, Checkbox, Field, Input, Select } from '@/components/ui';
import { updateGeneralSettingsAction } from '@/server/actions/settings';
import { CREW_ROLE_LABELS } from '@/lib/permissions';
import { useRun, WEEKDAYS } from '@/features/people/bits';

export interface GeneralValues {
  readonly weekStart: number;
  readonly pinLength: 4 | 6;
  readonly numberPrefixTemp: string;
  readonly defaultMemberRole: string;
  readonly defaultTimezone: string;
  readonly agencyLinks: boolean;
}

export function GeneralPanel({ settings }: { readonly settings: GeneralValues }) {
  const { run, pending, fields } = useRun();
  const [form, setForm] = useState(settings);
  const set = <K extends keyof GeneralValues>(key: K, value: GeneralValues[K]) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <Panel title="General">
      <div className="grid gap-3 sm:grid-cols-3" data-testid="settings-general">
        <Field label="Week starts on" hint="For new sites. Each site keeps its own.">
          {({ inputId }) => <Select id={inputId} value={String(form.weekStart)} onValueChange={(value) => set('weekStart', Number(value))} options={WEEKDAYS.map((day, index) => ({ value: String(index), label: day }))} />}
        </Field>
        <Field label="Kiosk PIN length">
          {({ inputId }) => <Select id={inputId} value={String(form.pinLength)} onValueChange={(value) => set('pinLength', value === '6' ? 6 : 4)} options={[{ value: '4', label: '4 digits' }, { value: '6', label: '6 digits' }]} />}
        </Field>
        <Field label="Number prefix for temps" hint="Temps with no number get this and the next number, like T-1001." error={fields.numberPrefixTemp ?? null}>
          {({ inputId, invalid }) => <Input id={inputId} invalid={invalid} value={form.numberPrefixTemp} maxLength={8} onChange={(event) => set('numberPrefixTemp', event.target.value)} />}
        </Field>
        <Field label="Role for plain members" hint="What a member of the workspace with no Crew role gets.">
          {({ inputId }) => <Select id={inputId} value={form.defaultMemberRole} onValueChange={(value) => set('defaultMemberRole', value)} options={(['supervisor', 'lead', 'viewer', 'none'] as const).map((role) => ({ value: role, label: CREW_ROLE_LABELS[role] }))} />}
        </Field>
        <Field label="Time zone for new sites" error={fields.defaultTimezone ?? null}>
          {({ inputId, invalid }) => <Input id={inputId} invalid={invalid} value={form.defaultTimezone} onChange={(event) => set('defaultTimezone', event.target.value)} placeholder="America/Chicago" />}
        </Field>
        <div className="flex items-end pb-1.5">
          <Checkbox label="Agency links" description="Agencies can type in their own people." checked={form.agencyLinks} onCheckedChange={(on) => set('agencyLinks', on === true)} />
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <Button variant="secondary" loading={pending === 'save'} onClick={() => void run('save', () => updateGeneralSettingsAction(form), { success: 'Settings saved' })} data-testid="settings-general-save">
          Save
        </Button>
      </div>
    </Panel>
  );
}
