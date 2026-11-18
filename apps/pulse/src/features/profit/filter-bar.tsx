'use client';
/**
 * Site, client, job type and job status filters. Values live in the URL (`site`, `client`,
 * `jobType`, `status`); "all" means no filter. Each select hides when there is nothing to pick.
 */
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { JOB_STATUS_LABELS, JOB_STATUS_VALUES, type JobStatusValue } from '@/lib/constants';
import type { ClientDTO, JobTypeDTO, SiteDTO } from '@/lib/types';

export interface FilterValues {
  readonly siteId: string | null;
  readonly clientId: string | null;
  readonly jobTypeId: string | null;
  readonly status: JobStatusValue | null;
}

const ALL = 'all';

export function FilterBar({
  values,
  onChange,
  sites,
  clients,
  jobTypes,
  hide = [],
}: {
  readonly values: FilterValues;
  readonly onChange: (patch: Partial<FilterValues>) => void;
  readonly sites: readonly SiteDTO[];
  readonly clients: readonly ClientDTO[];
  readonly jobTypes: readonly JobTypeDTO[];
  readonly hide?: readonly (keyof FilterValues)[];
}) {
  const active = [values.siteId, values.clientId, values.jobTypeId, values.status].filter(Boolean).length;
  const pick = (value: string): string | null => (value === ALL ? null : value);
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="filter-bar">
      {sites.length > 1 && !hide.includes('siteId') ? (
        <div className="w-[150px]">
          <Select aria-label="Site" value={values.siteId ?? ALL} onValueChange={(value) => onChange({ siteId: pick(value) })} options={[{ value: ALL, label: 'All sites' }, ...sites.map((site) => ({ value: site.id, label: site.name }))]} />
        </div>
      ) : null}
      {clients.length > 0 && !hide.includes('clientId') ? (
        <div className="w-[180px]">
          <Select aria-label="Client" value={values.clientId ?? ALL} onValueChange={(value) => onChange({ clientId: pick(value) })} options={[{ value: ALL, label: 'All clients' }, ...clients.map((client) => ({ value: client.id, label: client.name }))]} />
        </div>
      ) : null}
      {jobTypes.length > 1 && !hide.includes('jobTypeId') ? (
        <div className="w-[170px]">
          <Select aria-label="Job type" value={values.jobTypeId ?? ALL} onValueChange={(value) => onChange({ jobTypeId: pick(value) })} options={[{ value: ALL, label: 'All job types' }, ...jobTypes.map((type) => ({ value: type.id, label: type.name }))]} />
        </div>
      ) : null}
      {!hide.includes('status') ? (
        <div className="w-[150px]">
          <Select aria-label="Job status" value={values.status ?? ALL} onValueChange={(value) => onChange({ status: pick(value) as JobStatusValue | null })} options={[{ value: ALL, label: 'Any job status' }, ...JOB_STATUS_VALUES.map((status) => ({ value: status, label: JOB_STATUS_LABELS[status] }))]} />
        </div>
      ) : null}
      {active > 0 ? (
        <Button variant="ghost" size="sm" leadingIcon={<X aria-hidden />} onClick={() => onChange({ siteId: null, clientId: null, jobTypeId: null, status: null })} data-testid="filters-clear">
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}

/** Reads the four filters from a query getter. Bad values are dropped. */
export function parseFilters(get: (name: string) => string | null | undefined): FilterValues {
  const uuid = (value: string | null | undefined): string | null => (value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : null);
  const status = get('status');
  return { siteId: uuid(get('site')), clientId: uuid(get('client')), jobTypeId: uuid(get('jobType')), status: (JOB_STATUS_VALUES as readonly string[]).includes(status ?? '') ? (status as JobStatusValue) : null };
}
