'use client';
/**
 * Manager for device links of one kind (floor tablet or wall display): make a link, copy it once,
 * turn it off, give it more days. For floor tablets it also holds the PINs people unlock with.
 * Mount it anywhere inside the signed in shell: `<DeviceLinksPanel kind="kiosk" />`.
 */
import { useState } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  Link2,
  Plus,
  Power,
  RefreshCw,
  TabletSmartphone,
  Tv,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Badge, Button, IconButton, Input, Select, Skeleton, toast } from '@/components/ui';
import { cn } from '@/components/ui/cn';
import { floorKeys, useDeviceLinks, useMyKioskPin } from '@/features/log/floor-hooks';
import { useShell } from '@/features/shell/shell-context';
import { formatRelative } from '@/lib/dates';
import { useServerAction } from '@/lib/hooks/use-action';
import { useMemberRoles, useSites } from '@/lib/hooks/use-data';
import { PULSE_ROLE_LABELS, canPulse } from '@/lib/permissions';
import { shortDate } from '@/lib/profit';
import { qk } from '@/lib/query-keys';
import type { CreatedDeviceLinkDTO, DeviceLinkDTO } from '@/lib/types';
import {
  createDeviceLinkAction,
  renewDeviceLinkAction,
  revokeDeviceLinkAction,
  setMyKioskPinAction,
} from '@/server/actions/floor';
import { setKioskPinAction } from '@/server/actions/settings';

const WORDS = {
  kiosk: {
    one: 'floor tablet link',
    icon: TabletSmartphone,
    placeholder: 'Line 2 tablet',
    empty: 'No floor tablet links yet. Make one, then open it on the tablet and keep that page open.',
  },
  wall: {
    one: 'wall display link',
    icon: Tv,
    placeholder: 'Break room TV',
    empty: 'No wall display links yet. Make one, then open it on the TV browser.',
  },
} as const;

export function DeviceLinksPanel({
  kind,
  defaultSiteId,
}: {
  readonly kind: 'kiosk' | 'wall';
  readonly defaultSiteId?: string | null;
}) {
  const shell = useShell();
  const canManage = shell.can('device:manage');
  const queryClient = useQueryClient();
  const links = useDeviceLinks(kind, { enabled: canManage });
  const sites = useSites();
  const [name, setName] = useState('');
  const [siteId, setSiteId] = useState<string | undefined>(defaultSiteId ?? undefined);
  const [fresh, setFresh] = useState<CreatedDeviceLinkDTO | null>(null);
  const [copied, setCopied] = useState(false);
  const invalidate = [floorKeys.deviceLinks(kind), floorKeys.deviceLinks(null)];
  const create = useServerAction(createDeviceLinkAction, { invalidate });
  const revoke = useServerAction(revokeDeviceLinkAction, { invalidate });
  const renew = useServerAction(renewDeviceLinkAction, { invalidate });
  const words = WORDS[kind];
  const siteOptions = (sites.data ?? [])
    .filter((site) => !site.archivedAt)
    .map((site) => ({ value: site.id, label: site.name }));
  const chosenSite =
    siteId ??
    siteOptions.find((option) => (sites.data ?? []).find((site) => site.id === option.value)?.isDefault)
      ?.value ??
    siteOptions[0]?.value;

  const urlOf = (path: string) => (typeof window === 'undefined' ? path : `${window.location.origin}${path}`);

  async function make() {
    if (!name.trim()) {
      toast.warning(
        'Give the link a name',
        `For example "${words.placeholder}", so you can tell links apart later.`,
      );
      return;
    }
    const made = await create.run({ kind, name: name.trim(), siteId: chosenSite ?? null });
    if (!made) return;
    setFresh(made);
    setCopied(false);
    setName('');
  }

  async function copy(path: string) {
    try {
      await navigator.clipboard.writeText(urlOf(path));
      setCopied(true);
      toast.success('Link copied', 'Open it on the device and leave the page open.');
    } catch {
      toast.warning('Copy did not work', 'Select the link and copy it by hand.');
    }
  }

  async function turnOff(link: DeviceLinkDTO) {
    const done = await revoke.run({ linkId: link.id });
    if (!done) return;
    if (fresh?.link.id === link.id) setFresh(null);
    toast.undo(`Turned off "${link.name}"`, {
      description: 'The device shows "This link is not active" from now on.',
      onUndo: async () => {
        await renew.run({ linkId: link.id });
        await queryClient.invalidateQueries({ queryKey: floorKeys.deviceLinks(kind) });
      },
    });
  }

  return (
    <div className="flex flex-col gap-5" data-testid={`device-links-${kind}`}>
      {canManage ? (
        <section className="flex flex-col gap-3" aria-label={`Make a ${words.one}`}>
          <form
            className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_200px_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              void make();
            }}
          >
            <label className="flex flex-col gap-1 text-xs text-fg-muted">
              Name of the device
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={words.placeholder}
                maxLength={80}
                aria-label="Name of the device"
              />
            </label>
            {siteOptions.length > 1 ? (
              <label className="flex flex-col gap-1 text-xs text-fg-muted">
                Site
                <Select
                  aria-label="Site for the device"
                  value={chosenSite}
                  onValueChange={setSiteId}
                  options={siteOptions}
                />
              </label>
            ) : (
              <span className="hidden sm:block" />
            )}
            <Button type="submit" leadingIcon={<Plus aria-hidden />} loading={create.pending}>
              Make a link
            </Button>
          </form>
          {fresh ? (
            <div
              role="status"
              data-testid="new-device-link"
              className="flex flex-col gap-2 rounded-lg border border-success/40 bg-success-subtle p-3"
            >
              <p className="text-sm font-medium text-fg">
                <Check aria-hidden className="mr-1 inline size-4 align-[-3px] text-success-text" />“
                {fresh.link.name}” is ready. Copy the link now: for safety, Pulse cannot show it again.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  readOnly
                  aria-label="The new link"
                  value={urlOf(fresh.path)}
                  onFocus={(event) => event.currentTarget.select()}
                  className="h-9 min-w-0 flex-1 basis-64 rounded-md border border-border-input bg-panel px-2 font-mono text-xs text-fg"
                />
                <Button
                  variant="secondary"
                  leadingIcon={copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                  onClick={() => void copy(fresh.path)}
                >
                  {copied ? 'Copied' : 'Copy link'}
                </Button>
                <a
                  href={fresh.path}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-fg-link hover:underline focus-visible:outline-2 focus-visible:outline-focus"
                >
                  Open <ExternalLink aria-hidden className="size-3.5" />
                </a>
              </div>
              <p className="text-xs text-fg-secondary">
                It works for 90 days at {fresh.link.siteName}. Anyone with the link can open the screen, so
                share it only with the device.
              </p>
            </div>
          ) : null}
        </section>
      ) : (
        <p className="rounded-lg border border-border-subtle bg-sunken px-3 py-2 text-sm text-fg-secondary">
          A manager makes the link for a shared device. You can set your own PIN below.
        </p>
      )}

      {canManage ? (
        <section aria-label="Links" className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-fg">Links</h3>
          {links.isLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton height={44} className="w-full" />
              <Skeleton height={44} className="w-full" />
            </div>
          ) : links.isError ? (
            <div
              role="alert"
              className="flex items-center justify-between gap-3 rounded-lg border border-danger/40 bg-danger-subtle px-3 py-2 text-sm text-danger-text"
            >
              <span>We could not load the links. {links.error.message}</span>
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={<RefreshCw aria-hidden />}
                onClick={() => void links.refetch()}
              >
                Try again
              </Button>
            </div>
          ) : (links.data ?? []).length === 0 ? (
            <p className="flex items-start gap-2 rounded-lg border border-dashed border-border-default px-3 py-3 text-sm text-fg-secondary">
              <words.icon aria-hidden className="mt-0.5 size-4 shrink-0 text-icon" />
              {words.empty}
            </p>
          ) : (
            <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle">
              {(links.data ?? []).map((link) => (
                <li key={link.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <Link2 aria-hidden className="size-4 shrink-0 text-icon" />
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="truncate text-sm font-medium text-fg">{link.name}</p>
                    <p className="truncate text-xs text-fg-muted">
                      {link.siteName}. Starts with <span className="font-mono">{link.tokenPrefix}</span>.{' '}
                      {link.lastSeenAt ? `Last opened ${formatRelative(link.lastSeenAt)}` : 'Not opened yet'}.
                    </p>
                  </div>
                  <Badge
                    tone={
                      link.status === 'active' ? 'success' : link.status === 'expired' ? 'warning' : 'neutral'
                    }
                  >
                    {link.status === 'active'
                      ? `Works until ${shortDate(link.expiresAt.slice(0, 10))}`
                      : link.status === 'expired'
                        ? 'Ran out'
                        : 'Turned off'}
                  </Badge>
                  {link.status === 'active' ? (
                    <IconButton
                      label={`Turn off ${link.name}`}
                      icon={<Power aria-hidden />}
                      size="sm"
                      variant="ghost"
                      loading={revoke.pending}
                      onClick={() => void turnOff(link)}
                    />
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={renew.pending}
                      onClick={() =>
                        void renew.run({ linkId: link.id }).then((done) => {
                          if (done)
                            toast.success(
                              `"${link.name}" works again`,
                              'The same link is good for 90 more days.',
                            );
                        })
                      }
                    >
                      Turn on for 90 days
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {kind === 'kiosk' ? <KioskPins /> : null}
    </div>
  );
}

function PinField({
  label,
  onSave,
  pending,
}: {
  readonly label: string;
  readonly onSave: (pin: string) => Promise<boolean>;
  readonly pending: boolean;
}) {
  const [pin, setPin] = useState('');
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!/^\d{4}$/.test(pin)) {
          toast.warning('A PIN is 4 digits', 'Use numbers only, like 4821.');
          return;
        }
        void onSave(pin).then((ok) => ok && setPin(''));
      }}
    >
      <input
        aria-label={label}
        value={pin}
        onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
        inputMode="numeric"
        autoComplete="off"
        type="password"
        placeholder="4 digits"
        className="h-8 w-24 rounded-md border border-border-input bg-panel px-2 text-center text-sm tracking-[0.3em] text-fg placeholder:tracking-normal placeholder:text-fg-placeholder focus-visible:border-focus focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus"
      />
      <Button type="submit" variant="secondary" size="md" loading={pending} disabled={pin.length !== 4}>
        Set PIN
      </Button>
    </form>
  );
}

function KioskPins() {
  const shell = useShell();
  const queryClient = useQueryClient();
  const canSetOthers = shell.can('roles:manage');
  const mine = useMyKioskPin();
  const people = useMemberRoles({ enabled: canSetOthers });
  const setMine = useServerAction(setMyKioskPinAction, { invalidate: [floorKeys.myPin(), qk.roles()] });
  const [busyFor, setBusyFor] = useState<string | null>(null);

  async function setPinFor(userId: string, name: string, pin: string | null): Promise<boolean> {
    setBusyFor(userId);
    try {
      const result = await setKioskPinAction({ userId, pin });
      if (!result.ok) {
        toast.error("Couldn't save the PIN", result.error.message);
        return false;
      }
      toast.success(
        pin ? `PIN set for ${name}` : `PIN removed for ${name}`,
        pin ? 'Tell them the 4 digits in person.' : undefined,
      );
      await queryClient.invalidateQueries({ queryKey: qk.roles() });
      return true;
    } catch {
      toast.error("Couldn't save the PIN", 'Check your connection and try again.');
      return false;
    } finally {
      setBusyFor(null);
    }
  }
  const floorPeople = (people.data ?? []).filter((person) => canPulse(person.role, 'production:log'));

  return (
    <section aria-label="Tablet PINs" className="flex flex-col gap-2">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-fg">
        <KeyRound aria-hidden className="size-4 text-icon" /> PINs
      </h3>
      <p className="text-sm text-fg-muted">
        On the tablet, people pick their name and type a 4 digit PIN. Only people with a PIN show up there.
        Entries are saved under the person who unlocked.
      </p>
      {mine.data?.canUseKiosk ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-subtle px-3 py-2">
          <div>
            <p className="text-sm font-medium text-fg">Your PIN</p>
            <p className={cn('text-xs', mine.data.hasKioskPin ? 'text-success-text' : 'text-fg-muted')}>
              {mine.data.hasKioskPin
                ? 'You have a PIN. Set a new one any time.'
                : 'You do not have a PIN yet.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <PinField
              label="Your new PIN"
              pending={setMine.pending}
              onSave={async (pin) => {
                const done = await setMine.run({ pin });
                if (done) toast.success('Your PIN is set', 'Your name now shows on the floor tablet.');
                return Boolean(done);
              }}
            />
            {mine.data.hasKioskPin ? (
              <Button
                variant="tertiary"
                onClick={() =>
                  void setMine.run({ pin: null }).then((done) => {
                    if (done) toast.success('Your PIN is removed');
                  })
                }
              >
                Remove
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      {canSetOthers ? (
        people.isLoading ? (
          <Skeleton height={44} className="w-full" />
        ) : floorPeople.length === 0 ? (
          <p className="text-sm text-fg-muted">
            Nobody else can log production yet. Give people the Supervisor role under Settings, People and
            roles.
          </p>
        ) : (
          <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle">
            {floorPeople
              .filter((person) => person.id !== shell.user.id)
              .map((person) => (
                <li key={person.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-fg">{person.name}</p>
                    <p className="text-xs text-fg-muted">
                      {PULSE_ROLE_LABELS[person.role]}. {person.hasKioskPin ? 'Has a PIN.' : 'No PIN yet.'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <PinField
                      label={`New PIN for ${person.name}`}
                      pending={busyFor === person.id}
                      onSave={(pin) => setPinFor(person.id, person.name, pin)}
                    />
                    {person.hasKioskPin ? (
                      <Button variant="tertiary" onClick={() => void setPinFor(person.id, person.name, null)}>
                        Remove
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
          </ul>
        )
      ) : null}
    </section>
  );
}
