'use client';
/** Time clock access on the Overview tab: kiosk PIN reset (a new slip), badge set and reset, and remove for a mistake. */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BadgeCheck, Trash2 } from 'lucide-react';
import { Panel } from '@/components/layout/page';
import { Badge, Button, ConfirmDialog, Input } from '@/components/ui';
import { removePersonAction, setBadgeAction } from '@/server/actions/people';
import type { PersonDto } from '@/server/domain/people-dto';
import { formatWhen } from '@/lib/dates';
import { routes } from '@/lib/routes';
import { useRun } from './bits';
import { PinSlipsButton } from './pin-slips';

export function PersonClock({ person }: { readonly person: PersonDto }) {
  const router = useRouter();
  const { run, pending } = useRun();
  const [badge, setBadge] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  return (
    <Panel title="Time clock">
      <div className="grid gap-4 sm:grid-cols-2" data-testid="person-clock">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-fg">Kiosk PIN</p>
          <p className="text-sm text-fg-secondary">
            {person.hasPin ? `Set ${formatWhen(person.pinSetAt)}.` : 'No PIN yet.'} {person.pinLocked ? 'Locked after wrong tries.' : ''}
          </p>
          <div>
            <PinSlipsButton personIds={[person.id]} label={person.hasPin ? 'Reset PIN and print a slip' : 'Make a PIN and print a slip'} testId="reset-pin" />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-2 text-sm font-medium text-fg">
            Badge {person.hasBadge ? <Badge tone="success" icon={<BadgeCheck aria-hidden className="size-3" />}>Set</Badge> : <Badge tone="neutral">None</Badge>}
          </p>
          <div className="flex gap-2">
            <Input aria-label="Scan or type the new badge" placeholder="Scan the new badge" value={badge} onChange={(event) => setBadge(event.target.value)} data-testid="badge-input" />
            <Button
              variant="secondary"
              disabled={!badge.trim()}
              loading={pending === 'badge'}
              onClick={async () => {
                if (await run('badge', () => setBadgeAction({ personId: person.id, badge }), { success: 'Badge set' })) setBadge('');
              }}
            >
              Set
            </Button>
            {person.hasBadge ? (
              <Button variant="ghost" loading={pending === 'clear'} onClick={() => void run('clear', () => setBadgeAction({ personId: person.id, badge: null }), { success: 'Badge cleared' })}>
                Clear
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-fg-muted">A lost badge: scan the new one here. Crew keeps only a hash of it.</p>
        </div>
      </div>
      <div className="mt-4 flex justify-end border-t border-border-subtle pt-3">
        <Button variant="ghost" size="sm" leadingIcon={<Trash2 aria-hidden />} onClick={() => setConfirmRemove(true)}>
          Remove, added by mistake
        </Button>
      </div>
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        destructive
        title={`Remove ${person.displayName}?`}
        description="Only for someone added by mistake. A person who worked here should be set to Ended instead, so their history stays."
        confirmLabel="Remove"
        loading={pending === 'remove'}
        onConfirm={async () => {
          if (await run('remove', () => removePersonAction({ personId: person.id }), { success: 'Removed', refresh: false })) router.push(routes.people());
        }}
      />
    </Panel>
  );
}
