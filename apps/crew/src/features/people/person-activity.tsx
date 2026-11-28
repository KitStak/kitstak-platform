import { Panel } from '@/components/layout/page';
import type { ActivityDto } from '@/server/domain/people-dto';
import { formatWhen } from '@/lib/dates';

const VERBS: Readonly<Record<string, string>> = {
  'person.created': 'Added the person',
  'person.updated': 'Changed details',
  'person.removed': 'Removed the person',
  'person.pin_reset': 'Made a new kiosk PIN',
  'person.badge_set': 'Set a badge',
  'person.badge_cleared': 'Cleared the badge',
  'person.private_changed': 'Changed contact or emergency details',
  'person.pay_changed': 'Changed the pay type',
  'person.wage_set': 'Set a wage',
  'person.wage_removed': 'Removed a wage',
};

const FIELD_WORDS: Readonly<Record<string, string>> = {
  number: 'number',
  name: 'name',
  kind: 'kind',
  status: 'status',
  homeSiteId: 'home site',
  usualAreaId: 'usual area',
  laborClassId: 'labor class',
  leadPersonId: 'lead',
  agencyVendorId: 'agency',
  startDate: 'start date',
  endDate: 'end date',
  userId: 'login',
  email: 'email',
  phone: 'phone',
};

/** Which fields an update changed, in words. Only fields the reader may see are in the row (the server redacted it). */
function changed(entry: ActivityDto): string | null {
  if (entry.verb !== 'person.updated' || !entry.before || !entry.after) return null;
  const words = Object.keys(entry.after)
    .filter((key) => JSON.stringify(entry.after?.[key] ?? null) !== JSON.stringify(entry.before?.[key] ?? null))
    .map((key) => FIELD_WORDS[key] ?? key);
  return words.length > 0 ? words.join(', ') : 'nothing that you can see';
}

/** The Activity tab: every change, with who made it and when. */
export function PersonActivity({ entries }: { readonly entries: readonly ActivityDto[] }) {
  return (
    <Panel title="Activity">
      {entries.length === 0 ? (
        <p className="text-sm text-fg-muted">No changes yet.</p>
      ) : (
        <ol className="flex flex-col divide-y divide-border-subtle" data-testid="person-activity">
          {entries.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
              <div className="min-w-0">
                <p className="text-sm text-fg">
                  <span className="font-medium">{entry.actorName ?? (entry.actorKind === 'user' ? 'Someone' : 'Crew')}</span> {(VERBS[entry.verb] ?? entry.verb).toLowerCase()}
                  {changed(entry) ? <span className="text-fg-secondary">: {changed(entry)}</span> : null}
                </p>
              </div>
              <time className="text-xs text-fg-muted tabular-nums" dateTime={entry.createdAt}>
                {formatWhen(entry.createdAt)}
              </time>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
