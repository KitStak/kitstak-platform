import 'server-only';
import { Building2, FileSpreadsheet, UserPlus, Users } from 'lucide-react';
import { Page, Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/crew/button-link';
import { Teach } from '@/components/crew/teach';
import { listPeople, personFormOptions, type PeopleFilters } from '@/server/domain/people';
import { pageFor } from '@/server/page';
import { PERSON_KINDS, PERSON_STATUSES, type PersonKind, type PersonStatus } from '@/lib/csv/people';
import { routes } from '@/lib/routes';
import { BlockedPage } from './blocked';
import { PeopleView } from './people-view';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pickId = (value: string | undefined): string | null => (value && UUID.test(value) ? value : null);

export interface PeopleSearch {
  readonly q?: string;
  readonly site?: string;
  readonly kind?: string;
  readonly status?: string;
  readonly agency?: string;
  readonly class?: string;
}

export function filtersFrom(search: PeopleSearch): PeopleFilters {
  const kind = search.kind && (PERSON_KINDS as readonly string[]).includes(search.kind) ? (search.kind as PersonKind) : null;
  const status = search.status === 'all' ? 'all' : search.status && (PERSON_STATUSES as readonly string[]).includes(search.status) ? (search.status as PersonStatus) : 'current';
  return { q: search.q?.slice(0, 80) ?? null, siteId: pickId(search.site), kind, status, agencyId: pickId(search.agency), laborClassId: pickId(search.class) };
}

/** `/people` (docs/crew/SPEC.md 6.1): the list with search, filters, bulk actions and the CSV export of the view. */
export async function PeoplePage({ search }: { readonly search: PeopleSearch }) {
  const { ctx, can, locked, access } = await pageFor('/people');
  if (locked) return null;
  if (!can('crew:read')) return <BlockedPage title="People" role={access.role} />;
  const filters = filtersFrom(search);
  const [list, options] = await Promise.all([listPeople(ctx, filters), personFormOptions(ctx)]);
  const manage = can('person:manage');
  const filtered = Boolean(filters.q || filters.siteId || filters.kind || filters.agencyId || filters.laborClassId || filters.status !== 'current');
  return (
    <Page
      title="People"
      icon={<Users aria-hidden className="size-6 text-icon" />}
      subtitle={access.role === 'lead' ? 'Your crew on the floor.' : 'Everyone who works the floor, temps included. Most people never need a login.'}
      actions={
        manage ? (
          <>
            <ButtonLink href={routes.agencies()} variant="secondary" icon={<Building2 aria-hidden />}>
              Agencies
            </ButtonLink>
            {can('import:run') ? (
              <ButtonLink href={routes.importCenter()} variant="secondary" icon={<FileSpreadsheet aria-hidden />}>
                Import people
              </ButtonLink>
            ) : null}
            <ButtonLink href={routes.newPerson()} icon={<UserPlus aria-hidden />} testId="add-person">
              Add person
            </ButtonLink>
          </>
        ) : null
      }
    >
      {list.items.length === 0 && !filtered ? (
        <Panel>
          <Teach
            testId="people-empty"
            icon={Users}
            title={access.role === 'lead' ? 'Nobody is on your crew yet' : 'Add your people'}
            why={access.role === 'lead' ? 'A supervisor sets who you lead on each person. They show here when they do.' : 'Type the first people, or bring a whole agency crew in from one file. Crew makes numbers for temps.'}
            actions={
              manage ? (
                <>
                  <ButtonLink href={routes.newPerson()} icon={<UserPlus aria-hidden />}>
                    Add person
                  </ButtonLink>
                  {can('import:run') ? (
                    <ButtonLink href={routes.importCenter()} variant="secondary" icon={<FileSpreadsheet aria-hidden />}>
                      Import people
                    </ButtonLink>
                  ) : null}
                </>
              ) : null
            }
          />
        </Panel>
      ) : (
        <PeopleView
          items={list.items}
          privateHidden={list.privateHidden}
          options={{ sites: options.sites, agencies: options.agencies, laborClasses: options.laborClasses, leads: options.leads }}
          search={search}
          canManage={manage}
          canExport={can('export:run')}
        />
      )}
    </Page>
  );
}
