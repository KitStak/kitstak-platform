import 'server-only';
import { assignableRoles, LEDGER_ROLE_DESCRIPTIONS, LEDGER_SEATS, usesSeat, type LedgerRole } from '@/lib/permissions';
import type { PersonWithAccess } from '@/server/domain/setup-reads';
import { RolePicker } from './role-picker';

/** People and roles (SPEC 3.2, 3.3): every member with their Ledger role, editable by an owner or admin. */
export function PeopleList({ people, actorRole, canManage }: { readonly people: readonly PersonWithAccess[]; readonly actorRole: LedgerRole; readonly canManage: boolean }) {
  const seats = people.filter((person) => usesSeat(person.access.role)).length;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-fg-secondary" data-testid="seat-count">
        {seats} of {LEDGER_SEATS} included people have a role. Expense submitters do not count.
      </p>
      <ul className="divide-y divide-border-subtle" data-testid="people-list">
        {people.map((person) => {
          const choices = canManage && !(person.access.role === 'owner' && actorRole !== 'owner') ? assignableRoles(actorRole) : [];
          return (
            <li key={person.userId} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
              <span className="min-w-0">
                <span className="block truncate font-medium text-fg">{person.name}</span>
                <span className="block truncate text-xs text-fg-muted">
                  {person.email} · {LEDGER_ROLE_DESCRIPTIONS[person.access.role]}
                </span>
              </span>
              <RolePicker userId={person.userId} name={person.name} role={person.access.role} choices={choices} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
