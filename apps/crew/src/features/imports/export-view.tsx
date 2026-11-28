'use client';
/** The People export with site and status filters (docs/crew/SPEC.md 6.1 `/export`). */
import { useState } from 'react';
import { Download } from 'lucide-react';
import { Panel } from '@/components/layout/page';
import { Field, Select, type SelectOption } from '@/components/ui';
import { STATUS_LABELS } from '@/features/people/labels';

const ALL = '__all__';

export function PeopleExport({ sites, canSeePay, canSeePrivate }: { readonly sites: readonly SelectOption[]; readonly canSeePay: boolean; readonly canSeePrivate: boolean }) {
  const [site, setSite] = useState(ALL);
  const [status, setStatus] = useState('current');
  const params = new URLSearchParams();
  if (site !== ALL) params.set('site', site);
  if (status !== 'current') params.set('status', status);
  const href = `/api/v1/export/people.csv${params.size > 0 ? `?${params.toString()}` : ''}`;
  return (
    <Panel title="People">
      <p className="mb-3 text-sm text-fg-secondary">
        The People file in the same columns as its import template, so you can change it in Excel and import it back.
        {canSeePay ? '' : ' Pay columns are for payroll, so they are left out.'}
        {canSeePrivate ? '' : ' Emergency contacts are left out.'} Badges are never in a file: Crew keeps only a hash.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Site" className="w-56">
          {({ inputId }) => <Select id={inputId} value={site} onValueChange={setSite} options={[{ value: ALL, label: 'Every site' }, ...sites]} />}
        </Field>
        <Field label="Status" className="w-56">
          {({ inputId }) => <Select id={inputId} value={status} onValueChange={setStatus} options={[{ value: 'current', label: 'Active and on leave' }, ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })), { value: 'all', label: 'Every status' }]} />}
        </Field>
        <a href={href} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-fg hover:bg-primary-hover" data-testid="export-people">
          <Download aria-hidden className="size-4" />
          Download people.csv
        </a>
      </div>
    </Panel>
  );
}
