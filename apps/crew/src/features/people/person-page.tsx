import 'server-only';
import Link from 'next/link';
import { UserRound } from 'lucide-react';
import { Page, Panel } from '@/components/layout/page';
import { Teach } from '@/components/crew/teach';
import { Badge } from '@/components/ui';
import { getPerson, personFormOptions } from '@/server/domain/people';
import { isDomainError } from '@/server/errors';
import { pageFor } from '@/server/page';
import { arrivesIn, type BuildPhase } from '@/lib/pages';
import { routes } from '@/lib/routes';
import { PAGE_ICONS } from '@/features/phase/page-icons';
import { BlockedPage } from './blocked';
import { KIND_LABELS, STATUS_LABELS, STATUS_TONE } from './labels';
import { PersonActivity } from './person-activity';
import { PersonClock } from './person-clock';
import { PersonForm } from './person-form';
import { PersonOverviewRead } from './person-overview-read';
import { PersonPay } from './person-pay';

export const PERSON_TABS = [
  { id: 'overview', label: 'Overview', phase: 1 },
  { id: 'schedule', label: 'Schedule', phase: 2 },
  { id: 'time', label: 'Time', phase: 4 },
  { id: 'attendance', label: 'Attendance', phase: 5 },
  { id: 'time-off', label: 'Time off', phase: 5 },
  { id: 'skills', label: 'Skills', phase: 6 },
  { id: 'pay', label: 'Pay', phase: 1 },
  { id: 'activity', label: 'Activity', phase: 1 },
] as const satisfies readonly { id: string; label: string; phase: BuildPhase }[];
export type PersonTab = (typeof PERSON_TABS)[number]['id'];

/** `/people/[id]` (docs/crew/SPEC.md 6.1): tabs Overview, Pay and Activity now; the others arrive with their phases. */
export async function PersonPage({ personId, tab }: { readonly personId: string; readonly tab: string | undefined }) {
  const path = routes.person(personId);
  const { ctx, can, locked, access } = await pageFor(path);
  if (locked) return null;
  if (!can('crew:read')) return <BlockedPage title="Person" role={access.role} />;
  let detail;
  try {
    detail = await getPerson(ctx, personId);
  } catch (error) {
    if (isDomainError(error) && (error.code === 'NOT_FOUND' || error.code === 'VALIDATION')) {
      return (
        <Page title="Person" width="narrow">
          <Panel>
            <Teach icon={UserRound} title="This person is not here" why="They may have been removed, or they are outside the people you can see." testId="person-missing" />
          </Panel>
        </Page>
      );
    }
    throw error;
  }
  const person = detail.person;
  const tabs = PERSON_TABS.filter((entry) => entry.id !== 'pay' || can('pay:read'));
  const current: PersonTab = (tabs.find((entry) => entry.id === tab)?.id ?? 'overview') as PersonTab;
  const manage = can('person:manage');
  const options = manage ? await personFormOptions(ctx) : null;
  const later = tabs.find((entry) => entry.id === current && entry.phase > 1);
  const icon = PAGE_ICONS.person;
  const Icon = icon;
  return (
    <Page
      title={person.displayName}
      breadcrumbs={[{ label: 'People', href: routes.people() }, { label: person.displayName }]}
      icon={<Icon aria-hidden className="size-6 text-icon" />}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-mono tabular-nums">{person.number}</span>
          <span>{KIND_LABELS[person.kind] ?? person.kind}</span>
          <Badge tone={STATUS_TONE[person.status] ?? 'neutral'}>{STATUS_LABELS[person.status] ?? person.status}</Badge>
          {person.homeSiteName ? <span>{person.homeSiteName}</span> : null}
          {person.agencyName ? <span>from {person.agencyName}</span> : null}
        </span>
      }
      tabs={
        <nav aria-label="Person sections" className="flex items-end gap-6 border-b border-border-subtle px-6" data-testid="person-tabs">
          {tabs.map((entry) => (
            <Link
              key={entry.id}
              href={entry.id === 'overview' ? path : `${path}?tab=${entry.id}`}
              aria-current={entry.id === current ? 'page' : undefined}
              className={`relative -mb-px inline-flex h-9 items-center border-b-2 px-0.5 text-sm font-medium ${entry.id === current ? 'border-primary text-fg' : 'border-transparent text-fg-secondary hover:text-fg'}`}
              data-testid={`person-tab-${entry.id}`}
            >
              {entry.label}
            </Link>
          ))}
        </nav>
      }
      width={current === 'activity' ? 'default' : 'narrow'}
    >
      {later ? (
        <Panel>
          <Teach icon={UserRound} size="sm" title={`${later.label} is on its way`} why={`This tab shows ${person.displayName}'s ${later.label.toLowerCase()} once it lands.`} footnote={arrivesIn(later.phase)} testId={`person-tab-later-${later.id}`} />
        </Panel>
      ) : current === 'pay' ? (
        <PersonPay person={person} canManage={can('pay:manage')} />
      ) : current === 'activity' ? (
        <PersonActivity entries={detail.activity} />
      ) : (
        <div className="flex flex-col gap-4">
          {manage && options ? (
            <>
              <PersonClock person={person} />
              <PersonForm key={person.version} person={person} options={options} canSeePrivate={access.canSeePrivate} canManagePay={false} />
            </>
          ) : (
            <PersonOverviewRead person={person} />
          )}
        </div>
      )}
    </Page>
  );
}
