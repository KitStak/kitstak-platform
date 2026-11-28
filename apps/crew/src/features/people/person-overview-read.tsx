import { Panel } from '@/components/layout/page';
import type { PersonDto } from '@/server/domain/people-dto';
import { formatDate } from '@/lib/dates';
import { KIND_LABELS, LANGUAGE_LABELS, STATUS_LABELS } from './labels';

/** The Overview for a reader who may not edit (a lead or a viewer). Only what the server sent: no private or pay field reaches here. */
export function PersonOverviewRead({ person }: { readonly person: PersonDto }) {
  const rows: [string, string | null][] = [
    ['Number', person.number],
    ['Kind', KIND_LABELS[person.kind] ?? person.kind],
    ['Status', STATUS_LABELS[person.status] ?? person.status],
    ['Home site', person.homeSiteName],
    ['Usual area', person.usualAreaName],
    ['Labor class', person.laborClassName],
    ['Lead', person.leadName],
    ['Agency', person.agencyName],
    ['Start date', formatDate(person.startDate) || null],
    ['End date', formatDate(person.endDate) || null],
    ['Time clock language', LANGUAGE_LABELS[person.language] ?? person.language],
  ];
  if (!person.privateHidden) rows.push(['Email', person.email], ['Phone', person.phone], ['Emergency contact', person.emergencyName], ['Emergency phone', person.emergencyPhone]);
  return (
    <Panel title="Overview">
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2" data-testid="person-overview-read">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs font-medium text-fg-muted">{label}</dt>
            <dd className="text-sm text-fg">{value || 'Not set'}</dd>
          </div>
        ))}
      </dl>
      {person.privateHidden ? <p className="mt-4 text-xs text-fg-muted">Contact and emergency details are for supervisors and up.</p> : null}
    </Panel>
  );
}
