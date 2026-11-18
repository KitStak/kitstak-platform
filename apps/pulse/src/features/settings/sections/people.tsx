'use client';
/**
 * People and roles: who can use Pulse, what each person can do, and who can see money. Seeing
 * money is opt in. A role set here wins over the role a person gets from the warehouse or from
 * the workspace.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Crown, ExternalLink, Eye, EyeOff, KeyRound, RotateCcw, ShieldCheck, UserPlus } from 'lucide-react';
import { Badge, Button, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, Field, Input, Select, Skeleton, Switch, toast } from '@/components/ui';
import { Panel } from '@/components/layout/page';
import { PersonAvatar } from '@/components/pulse/person';
import { useShell } from '@/features/shell/shell-context';
import { useMemberRoles, useRunState } from '@/lib/hooks/use-data';
import { PULSE_ROLES, PULSE_ROLE_LABELS, canPulse, canSeeMoney, type PulseRole } from '@/lib/permissions';
import { qk } from '@/lib/query-keys';
import type { MemberRoleDTO, SettingsDTO } from '@/lib/types';
import { claimPulseOwnershipAction, clearMemberRoleAction, setKioskPinAction, setMemberRoleAction, updateSettingsAction } from '@/server/actions/settings';

const ROLE_HELP: Readonly<Record<PulseRole, string>> = {
  owner: 'Everything, including deleting all data and reopening a closed month.',
  admin: 'Rates, settings, roles and month close, plus all a manager can do.',
  manager: 'Jobs, plans, costs, revenue, imports and reviewing days. Sees money, never the wage.',
  supervisor: 'Logs work for the last 7 days. Sees units, hours and pace. No money unless you turn it on.',
  viewer: 'Reads every screen. No money unless you turn it on.',
  none: 'Cannot open Pulse.',
};

const SOURCE_WORDS: Readonly<Record<MemberRoleDTO['source'], string>> = {
  explicit: 'Set here',
  wms: 'From the warehouse app',
  org: 'From the workspace role',
};

export function PeopleSection({ settings, canEdit }: { readonly settings: SettingsDTO; readonly canEdit: boolean }) {
  const shell = useShell();
  const queryClient = useQueryClient();
  const roles = useMemberRoles();
  const runState = useRunState();
  const [busy, setBusy] = useState<string | null>(null);
  const [pinFor, setPinFor] = useState<MemberRoleDTO | null>(null);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const isOwner = shell.pulseRole === 'owner';

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: qk.roles() });
  };

  const change = async (person: MemberRoleDTO, patch: { role?: PulseRole; seesMoney?: boolean }, done: string): Promise<void> => {
    setBusy(person.id);
    const before = { role: person.role, seesMoney: person.seesMoneySwitch, explicit: person.source === 'explicit' };
    const result = await setMemberRoleAction({ userId: person.id, ...patch });
    setBusy(null);
    if (!result.ok) {
      toast.error('Could not change that', result.error.message);
      return;
    }
    await refresh();
    toast.undo(done, {
      onUndo: async () => {
        const back = before.explicit ? await setMemberRoleAction({ userId: person.id, role: before.role, seesMoney: before.seesMoney }) : await clearMemberRoleAction({ userId: person.id });
        if (!back.ok) throw new Error(back.error.message);
        await refresh();
      },
    });
  };

  const reset = async (person: MemberRoleDTO): Promise<void> => {
    setBusy(person.id);
    const before = { role: person.role, seesMoney: person.seesMoneySwitch };
    const result = await clearMemberRoleAction({ userId: person.id });
    setBusy(null);
    if (!result.ok) {
      toast.error('Could not reset that role', result.error.message);
      return;
    }
    await refresh();
    toast.undo(`${person.name} follows the workspace again`, {
      onUndo: async () => {
        const back = await setMemberRoleAction({ userId: person.id, role: before.role, seesMoney: before.seesMoney });
        if (!back.ok) throw new Error(back.error.message);
        await refresh();
      },
    });
  };

  const claim = async (): Promise<void> => {
    setBusy('claim');
    const result = await claimPulseOwnershipAction();
    setBusy(null);
    if (!result.ok) {
      toast.error('Could not do that', result.error.message);
      return;
    }
    toast.success('You now run Pulse for this workspace');
    await refresh();
    await queryClient.invalidateQueries({ queryKey: qk.runState() });
    window.location.reload();
  };

  const savePin = async (): Promise<void> => {
    if (!pinFor) return;
    if (pin !== '' && !/^\d{4}$/.test(pin)) {
      setPinError('Type 4 digits.');
      return;
    }
    setBusy(pinFor.id);
    const result = await setKioskPinAction({ userId: pinFor.id, pin: pin === '' ? null : pin });
    setBusy(null);
    if (!result.ok) {
      setPinError(result.error.message);
      return;
    }
    toast.success(pin === '' ? 'PIN removed' : `PIN set for ${pinFor.name}`);
    setPinFor(null);
    await refresh();
  };

  const setDefault = async (value: string): Promise<void> => {
    const before = settings.defaultMemberRole;
    const result = await updateSettingsAction({ defaultMemberRole: value as 'manager' | 'supervisor' | 'viewer' | 'none' });
    if (!result.ok) {
      toast.error('Could not change that', result.error.message);
      return;
    }
    queryClient.setQueryData(qk.settings(), result.data);
    await refresh();
    toast.undo('New members get that role now', {
      onUndo: async () => {
        const back = await updateSettingsAction({ defaultMemberRole: before as 'manager' | 'supervisor' | 'viewer' | 'none' });
        if (!back.ok) throw new Error(back.error.message);
        queryClient.setQueryData(qk.settings(), back.data);
        await refresh();
      },
    });
  };

  const list = roles.data ?? [];
  const moneyCount = list.filter((person) => person.seesMoney).length;
  const roleOptions = (person: MemberRoleDTO) =>
    PULSE_ROLES.filter((role) => role !== 'owner' || isOwner || person.role === 'owner').map((role) => ({ value: role, label: PULSE_ROLE_LABELS[role], description: ROLE_HELP[role] }));

  return (
    <div className="flex flex-col gap-5">
      {runState.data && !runState.data.hasOwner ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-warning/40 bg-warning-subtle px-4 py-3" data-testid="claim-banner">
          <Crown aria-hidden className="size-5 shrink-0 text-warning-text" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-fg">Nobody runs Pulse for this workspace yet</p>
            <p className="text-sm text-fg-secondary">The person who runs Pulse decides who can see money, sets labor rates and closes months.</p>
          </div>
          {runState.data.canClaim ? (
            <Button loading={busy === 'claim'} onClick={() => void claim()} data-testid="claim-button">
              Run Pulse for this workspace
            </Button>
          ) : null}
        </div>
      ) : null}

      <Panel title="People and roles" bodyClassName="p-0">
        <p className="border-b border-border-subtle px-4 py-3 text-sm text-fg-secondary" data-testid="money-summary">
          <span className="font-medium text-fg">Who can see money?</span> {moneyCount} of {list.length} {list.length === 1 ? 'person' : 'people'}. Owners, admins and managers always do. Supervisors and viewers only when you turn it on for them. Wages are shown to owners and admins only.
        </p>
        {roles.isError ? (
          <div className="flex flex-col items-center gap-3 px-4 py-8 text-center" role="alert">
            <p className="text-sm text-fg-secondary">We could not load the people of this workspace.</p>
            <Button variant="secondary" onClick={() => void roles.refetch()}>
              Try again
            </Button>
          </div>
        ) : roles.isLoading ? (
          <div className="p-4">
            <Skeleton height={160} />
          </div>
        ) : (
          <ul className="divide-y divide-border-subtle" data-testid="people-list">
            {list.map((person) => {
              const me = person.id === shell.user.id;
              const alwaysMoney = canSeeMoney(person.role, false);
              return (
                <li key={person.id} data-testid={`person-${person.email}`} className="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.9fr)_190px] lg:items-center">
                  <div className="flex min-w-0 items-center gap-3">
                    <PersonAvatar userId={person.id} size="md" />
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
                        <span className="truncate">{person.name}</span>
                        {me ? <Badge>You</Badge> : null}
                      </p>
                      <p className="truncate text-xs text-fg-muted">{person.email}</p>
                    </div>
                  </div>
                  <div className="min-w-0">
                    <Select
                      aria-label={`Pulse role of ${person.name}`}
                      value={person.role}
                      disabled={!canEdit || busy === person.id || (person.role === 'owner' && !isOwner)}
                      onValueChange={(role) => void change(person, { role: role as PulseRole }, `${person.name} is now ${PULSE_ROLE_LABELS[role as PulseRole].toLowerCase()}`)}
                      options={roleOptions(person)}
                    />
                    <p className="mt-1 text-xs text-fg-muted">{SOURCE_WORDS[person.source]}</p>
                  </div>
                  <div className="flex min-w-0 items-center gap-2 text-sm">
                    {alwaysMoney ? (
                      <span className="inline-flex items-center gap-1.5 text-fg-secondary">
                        <Eye aria-hidden className="size-4 text-success" />
                        Sees money{person.seesWages ? ' and wages' : ''}
                      </span>
                    ) : person.role === 'none' ? (
                      <span className="inline-flex items-center gap-1.5 text-fg-muted">
                        <EyeOff aria-hidden className="size-4" />
                        No access
                      </span>
                    ) : (
                      <label className="inline-flex items-center gap-2 text-fg-secondary">
                        <Switch
                          size="sm"
                          aria-label={`${person.name} can see money`}
                          checked={person.seesMoneySwitch}
                          disabled={!canEdit || busy === person.id}
                          onCheckedChange={(checked) => void change(person, { role: person.role, seesMoney: checked }, checked ? `${person.name} can see money now` : `${person.name} can no longer see money`)}
                          data-testid={`money-switch-${person.email}`}
                        />
                        {person.seesMoneySwitch ? 'Sees money' : 'No money'}
                      </label>
                    )}
                  </div>
                  {canEdit ? (
                    <div className="flex items-center gap-1 lg:justify-end">
                      {canPulse(person.role, 'production:log') ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          leadingIcon={<KeyRound aria-hidden className="size-3.5" />}
                          onClick={() => {
                            setPin('');
                            setPinError(null);
                            setPinFor(person);
                          }}
                          data-testid={`pin-${person.email}`}
                        >
                          {person.hasKioskPin ? 'Reset PIN' : 'Set PIN'}
                        </Button>
                      ) : null}
                      {person.source === 'explicit' && !(person.role === 'owner' && !isOwner) ? (
                        <Button size="sm" variant="ghost" leadingIcon={<RotateCcw aria-hidden className="size-3.5" />} disabled={busy === person.id} onClick={() => void reset(person)} data-testid={`reset-${person.email}`}>
                          Reset
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel title="Add a person">
        <div className="flex flex-wrap items-center gap-3" data-testid="add-person-help">
          <UserPlus aria-hidden className="size-5 shrink-0 text-icon-strong" />
          <p className="min-w-0 flex-1 basis-64 text-sm text-fg-secondary">
            People join your workspace from the KitStak Portal. Invite them there by email. When they sign in to Pulse with that email, they see the invitation and join. Then they show up in the list above, and you pick what they can do in Pulse and whether they see money.
          </p>
          {canEdit ? (
            <a
              href={`${shell.appUrls.portal}/settings/organization`}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border-input bg-panel px-3 text-sm font-medium text-fg hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              data-testid="invite-in-portal"
            >
              Invite in the Portal
              <ExternalLink aria-hidden className="size-3.5" />
            </a>
          ) : null}
        </div>
      </Panel>

      <Panel title="New members">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-start">
          <div className="flex items-start gap-2.5">
            <ShieldCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-icon-strong" />
            <p className="text-sm text-fg-secondary">When someone joins the workspace as a plain member and nobody has set their Pulse role, they get this one. &quot;No access&quot; is the safe choice: nobody sees your numbers until you say so.</p>
          </div>
          <Field label="Role for new members">
            {({ inputId }) => (
              <Select
                id={inputId}
                value={settings.defaultMemberRole === 'owner' || settings.defaultMemberRole === 'admin' ? 'none' : settings.defaultMemberRole}
                disabled={!canEdit}
                onValueChange={(value) => void setDefault(value)}
                options={(['none', 'viewer', 'supervisor', 'manager'] as const).map((role) => ({ value: role, label: PULSE_ROLE_LABELS[role], description: ROLE_HELP[role] }))}
              />
            )}
          </Field>
        </div>
      </Panel>

      <Dialog open={pinFor !== null} onOpenChange={(next) => !next && setPinFor(null)}>
        <DialogContent size="sm" data-testid="pin-dialog">
          <DialogHeader title={`Floor tablet PIN for ${pinFor?.name ?? ''}`} description="The 4 digits this person types on the shared tablet to log work under their own name. Leave it empty to remove the PIN." />
          <DialogBody>
            <form
              id="pin-form"
              className="pb-2"
              onSubmit={(event) => {
                event.preventDefault();
                void savePin();
              }}
            >
              <Field label="PIN" error={pinError}>
                {({ inputId, invalid }) => (
                  <Input
                    id={inputId}
                    invalid={invalid}
                    autoFocus
                    inputMode="numeric"
                    maxLength={4}
                    value={pin}
                    onChange={(event) => {
                      setPin(event.target.value.replace(/\D/g, ''));
                      setPinError(null);
                    }}
                    placeholder="4 digits"
                    autoComplete="off"
                    data-testid="pin-input"
                  />
                )}
              </Field>
            </form>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPinFor(null)}>
              Cancel
            </Button>
            <Button type="submit" form="pin-form" loading={busy === pinFor?.id} data-testid="pin-save">
              {pin === '' ? 'Remove PIN' : 'Save PIN'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
