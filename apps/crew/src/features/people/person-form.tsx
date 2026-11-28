'use client';
/**
 * The person form (docs/crew/SPEC.md 6.1 `/people/new` and the Overview tab): name, number (or
 * "make one"), kind, site, usual area, labor class, lead, agency for temps, dates, language,
 * contact, badge and the login link. Private and pay sections show only for readers with the
 * right; the server checks again.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Save } from 'lucide-react';
import { Panel } from '@/components/layout/page';
import { Button, Checkbox, Field, Input, IsoDatePicker, Select, Textarea } from '@/components/ui';
import { createPersonAction, updatePersonAction } from '@/server/actions/people';
import type { PersonDto } from '@/server/domain/people-dto';
import type { PersonFormOptions } from '@/server/domain/people';
import { routes } from '@/lib/routes';
import { centsToDecimal } from '@/lib/money';
import { dollarsToCents, KIND_LABELS, LANGUAGE_LABELS, OptionalSelect, STATUS_LABELS, useRun } from './bits';
import { PinSlipsButton } from './pin-slips';

type Kind = 'employee' | 'temp' | 'seasonal';
type Status = 'active' | 'on_leave' | 'ended';

interface FormState {
  number: string;
  firstName: string;
  lastName: string;
  preferredName: string;
  kind: Kind;
  status: Status;
  homeSiteId: string | null;
  usualAreaId: string | null;
  laborClassId: string | null;
  leadPersonId: string | null;
  agencyVendorId: string | null;
  agencyRef: string;
  startDate: string | null;
  endDate: string | null;
  language: 'en' | 'es';
  email: string;
  phone: string;
  notes: string;
  userId: string | null;
  notifyEmail: boolean;
  badge: string;
  emergencyName: string;
  emergencyPhone: string;
  emergencyRelation: string;
  payType: 'hourly' | 'salary';
  overtimeExempt: boolean;
  wage: string;
}

function initialState(person: PersonDto | null, options: PersonFormOptions): FormState {
  const defaultSite = options.sites.find((site) => site.isDefault)?.value ?? options.sites[0]?.value ?? null;
  return {
    number: person?.number ?? '',
    firstName: person?.firstName ?? '',
    lastName: person?.lastName ?? '',
    preferredName: person?.preferredName ?? '',
    kind: (person?.kind as Kind) ?? 'employee',
    status: (person?.status as Status) ?? 'active',
    homeSiteId: person?.homeSiteId ?? defaultSite,
    usualAreaId: person?.usualAreaId ?? null,
    laborClassId: person?.laborClassId ?? options.laborClasses.find((row) => row.isDefault)?.value ?? null,
    leadPersonId: person?.leadPersonId ?? null,
    agencyVendorId: person?.agencyVendorId ?? null,
    agencyRef: person?.agencyRef ?? '',
    startDate: person?.startDate ?? null,
    endDate: person?.endDate ?? null,
    language: person?.language === 'es' ? 'es' : 'en',
    email: person?.email ?? '',
    phone: person?.phone ?? '',
    notes: person?.notes ?? '',
    userId: person?.userId ?? null,
    notifyEmail: person?.notifyEmail ?? true,
    badge: '',
    emergencyName: person?.emergencyName ?? '',
    emergencyPhone: person?.emergencyPhone ?? '',
    emergencyRelation: person?.emergencyRelation ?? '',
    payType: person?.payType === 'salary' ? 'salary' : 'hourly',
    overtimeExempt: person?.overtimeExempt ?? false,
    wage: person?.wageCents != null ? centsToDecimal(person.wageCents) : '',
  };
}

export function PersonForm({ person, options, canSeePrivate, canManagePay }: { readonly person: PersonDto | null; readonly options: PersonFormOptions; readonly canSeePrivate: boolean; readonly canManagePay: boolean }) {
  const [form, setForm] = useState<FormState>(() => initialState(person, options));
  const [made, setMade] = useState<{ id: string; number: string } | null>(null);
  const { run, pending, fields } = useRun();
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));
  const areaOptions = useMemo(() => options.areas.filter((area) => area.siteId === form.homeSiteId), [options.areas, form.homeSiteId]);
  const leadOptions = useMemo(() => options.leads.filter((lead) => lead.value !== person?.id), [options.leads, person?.id]);
  const isNew = person === null;

  const save = async () => {
    const base = {
      number: form.number || null,
      firstName: form.firstName,
      lastName: form.lastName,
      preferredName: form.preferredName || null,
      kind: form.kind,
      status: form.status,
      homeSiteId: form.homeSiteId,
      usualAreaId: form.usualAreaId,
      laborClassId: form.laborClassId,
      leadPersonId: form.leadPersonId,
      agencyVendorId: form.kind === 'temp' ? form.agencyVendorId : null,
      agencyRef: form.kind === 'temp' ? form.agencyRef || null : null,
      startDate: form.startDate,
      endDate: form.endDate,
      language: form.language,
      email: canSeePrivate ? form.email || null : undefined,
      phone: canSeePrivate ? form.phone || null : undefined,
      notes: canSeePrivate ? form.notes || null : undefined,
      userId: form.userId,
      notifyEmail: form.notifyEmail,
    };
    const privatePart = canSeePrivate ? { emergencyName: form.emergencyName || null, emergencyPhone: form.emergencyPhone || null, emergencyRelation: form.emergencyRelation || null } : undefined;
    if (isNew) {
      const wageCents = form.wage.trim() ? dollarsToCents(form.wage) : null;
      if (form.wage.trim() && wageCents === null) {
        set('wage', form.wage);
        return;
      }
      const result = await run('save', () => createPersonAction({ person: { ...base, badge: form.badge || null }, private: privatePart, pay: canManagePay ? { payType: form.payType, overtimeExempt: form.overtimeExempt, wageCents } : undefined }), { success: 'Person added', failure: 'Could not add this person' });
      if (result) setMade({ id: result.id, number: result.number });
    } else {
      await run('save', () => updatePersonAction({ personId: person.id, version: person.version, person: base, private: privatePart }), { success: 'Saved', failure: 'Could not save' });
    }
  };

  if (made) {
    return (
      <Panel>
        <div className="flex flex-col items-start gap-3" data-testid="person-made">
          <p className="flex items-center gap-2 text-base font-medium text-fg">
            <CheckCircle2 aria-hidden className="size-5 text-success" />
            {form.firstName} {form.lastName} is in Crew as number {made.number}.
          </p>
          <p className="text-sm text-fg-secondary">Print a PIN slip so they can use the time clock. The PIN shows only once.</p>
          <div className="flex flex-wrap gap-2">
            <PinSlipsButton personIds={[made.id]} label="Print PIN slip" variant="primary" />
            <Link href={routes.person(made.id)} className="inline-flex h-8 items-center rounded-md border border-border-input bg-panel px-3 text-sm font-medium text-fg hover:bg-muted">
              Open the person
            </Link>
            <Button
              variant="ghost"
              onClick={() => {
                setMade(null);
                setForm(initialState(null, options));
              }}
            >
              Add another
            </Button>
          </div>
        </div>
      </Panel>
    );
  }

  const text = (key: keyof FormState, label: string, extra: { hint?: string; required?: boolean; type?: string; placeholder?: string } = {}) => (
    <Field label={label} hint={extra.hint} required={extra.required} error={fields[key] ?? fields[`person.${key}`] ?? null}>
      {({ inputId, describedBy, invalid }) => (
        <Input id={inputId} aria-describedby={describedBy} invalid={invalid} type={extra.type ?? 'text'} placeholder={extra.placeholder} value={String(form[key] ?? '')} onChange={(event) => set(key, event.target.value as never)} data-testid={`person-${key}`} />
      )}
    </Field>
  );

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <Panel title="Who they are">
        <div className="grid gap-3 sm:grid-cols-2">
          {text('firstName', 'First name', { required: true })}
          {text('lastName', 'Last name', { required: true })}
          {text('preferredName', 'Preferred name', { hint: 'The name they go by, when it is not the first name.' })}
          {text('number', 'Employee number', { hint: isNew ? `Leave it empty and Crew makes one, like ${options.numberPrefix}1001.` : 'The number on the time clock.', placeholder: isNew ? 'Make one for me' : undefined })}
          <Field label="Kind">
            {({ inputId }) => <Select id={inputId} value={form.kind} onValueChange={(value) => set('kind', value as Kind)} options={Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label }))} data-testid="person-kind" />}
          </Field>
          <Field label="Status" error={fields.endDate ? null : null}>
            {({ inputId }) => <Select id={inputId} value={form.status} onValueChange={(value) => set('status', value as Status)} options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))} />}
          </Field>
        </div>
      </Panel>
      <Panel title="Where they work">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Home site" required error={fields.homeSiteId ?? null}>
            {({ inputId }) => (
              <Select
                id={inputId}
                value={form.homeSiteId ?? undefined}
                onValueChange={(value) => setForm((current) => ({ ...current, homeSiteId: value, usualAreaId: null }))}
                options={options.sites}
                placeholder="Pick a site"
              />
            )}
          </Field>
          <Field label="Usual area" error={fields.usualAreaId ?? null}>
            {({ inputId }) => <OptionalSelect id={inputId} value={form.usualAreaId} onChange={(value) => set('usualAreaId', value)} options={areaOptions} />}
          </Field>
          <Field label="Labor class" error={fields.laborClassId ?? null}>
            {({ inputId }) => <OptionalSelect id={inputId} value={form.laborClassId} onChange={(value) => set('laborClassId', value)} options={options.laborClasses} />}
          </Field>
          <Field label="Lead" hint="Who leads them on the floor. That lead sees them." error={fields.leadPersonId ?? null}>
            {({ inputId }) => <OptionalSelect id={inputId} value={form.leadPersonId} onChange={(value) => set('leadPersonId', value)} options={leadOptions} />}
          </Field>
          {form.kind === 'temp' ? (
            <>
              <Field label="Agency" hint={options.agencies.length === 0 ? 'Add an agency under People, Agencies first.' : undefined} error={fields.agencyVendorId ?? null}>
                {({ inputId }) => <OptionalSelect id={inputId} value={form.agencyVendorId} onChange={(value) => set('agencyVendorId', value)} options={options.agencies} testId="person-agency" />}
              </Field>
              {text('agencyRef', 'Agency person id', { hint: 'The id the agency uses for them.' })}
            </>
          ) : null}
          <Field label="Start date" error={fields.startDate ?? null}>
            {({ inputId }) => <IsoDatePicker id={inputId} value={form.startDate} onChange={(value) => set('startDate', value)} clearable />}
          </Field>
          <Field label="End date" hint={form.status === 'ended' ? 'Needed for an ended person.' : undefined} error={fields.endDate ?? null}>
            {({ inputId }) => <IsoDatePicker id={inputId} value={form.endDate} onChange={(value) => set('endDate', value)} clearable />}
          </Field>
          <Field label="Time clock language">
            {({ inputId }) => <Select id={inputId} value={form.language} onValueChange={(value) => set('language', value as 'en' | 'es')} options={Object.entries(LANGUAGE_LABELS).map(([value, label]) => ({ value, label }))} />}
          </Field>
          <Field label="Login" hint="Link a sign in so they get the phone clock and My work. Most people never need one." error={fields.userId ?? null}>
            {({ inputId }) => <OptionalSelect id={inputId} value={form.userId} onChange={(value) => set('userId', value)} options={options.members.map((m) => ({ value: m.value, label: `${m.label} (${m.email})` }))} noneLabel="No login" />}
          </Field>
          {isNew ? text('badge', 'Badge', { hint: 'What the badge scanner reads. Crew keeps only a hash of it.' }) : null}
        </div>
      </Panel>
      {canSeePrivate ? (
        <Panel title="Contact and emergency">
          <div className="grid gap-3 sm:grid-cols-2">
            {text('email', 'Email', { type: 'email' })}
            {text('phone', 'Phone', { type: 'tel' })}
            {text('emergencyName', 'Emergency contact')}
            {text('emergencyPhone', 'Emergency phone', { type: 'tel' })}
            {text('emergencyRelation', 'Relation')}
            <div className="flex items-end pb-1.5">
              <Checkbox label="Send schedule notices by email" checked={form.notifyEmail} onCheckedChange={(on) => set('notifyEmail', on === true)} />
            </div>
            <Field label="Notes" className="sm:col-span-2">
              {({ inputId }) => <Textarea id={inputId} value={form.notes} onChange={(event) => set('notes', event.target.value)} rows={2} />}
            </Field>
          </div>
          <p className="mt-3 text-xs text-fg-muted">Leads and viewers never see this section. The server leaves it out for them.</p>
        </Panel>
      ) : null}
      {isNew && canManagePay ? (
        <Panel title="Pay">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Pay type">
              {({ inputId }) => <Select id={inputId} value={form.payType} onValueChange={(value) => set('payType', value as 'hourly' | 'salary')} options={[{ value: 'hourly', label: 'Hourly' }, { value: 'salary', label: 'Salary' }]} />}
            </Field>
            <Field label="Wage per hour" hint="Used for Crew estimates when Pulse is not set up." error={form.wage.trim() && dollarsToCents(form.wage) === null ? 'Use dollars, like 19.50.' : (fields.wageCents ?? null)}>
              {({ inputId, invalid }) => <Input id={inputId} invalid={invalid} inputMode="decimal" placeholder="19.50" value={form.wage} onChange={(event) => set('wage', event.target.value)} data-testid="person-wage" />}
            </Field>
            <div className="flex items-end pb-1.5">
              <Checkbox label="Overtime exempt" checked={form.overtimeExempt} onCheckedChange={(on) => set('overtimeExempt', on === true)} />
            </div>
          </div>
        </Panel>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="submit" loading={pending === 'save'} leadingIcon={<Save aria-hidden />} data-testid="person-save">
          {isNew ? 'Add person' : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}
