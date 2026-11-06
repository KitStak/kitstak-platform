'use client';
/** Profile → Notifications: events × channels matrix, email digest and quiet hours. Autosaves. */
import { useState } from 'react';
import { Bell, Mail } from 'lucide-react';
import { Input, Select, Switch, toast } from '@/components/ui';
import { NOTIFICATION_EVENTS, type ProfileDto } from '@/server/services/admin-contracts';
import { useUpdateProfile } from '../api';
import { SettingRow, SettingsCard, SettingsSkeleton } from '../ui';

const DEFAULT_CHANNELS = { inApp: true, email: false };

export function NotificationsTab({ profile }: { readonly profile: ProfileDto | undefined }) {
  const update = useUpdateProfile();
  const [quiet, setQuiet] = useState<{ from: string; to: string } | null>(null);
  if (!profile) {
    return (
      <SettingsCard title="Notify me when…">
        <SettingsSkeleton rows={5} />
      </SettingsCard>
    );
  }
  const prefs = profile.prefs;
  const hours = quiet ?? { from: prefs.quietHours.from, to: prefs.quietHours.to };
  const toggle = (event: string, channel: 'inApp' | 'email', value: boolean) =>
    update.mutate({ notifications: { [event]: { [channel]: value } } });

  return (
    <div className="flex flex-col gap-6" data-testid="profile-notifications">
      <SettingsCard title="Notify me when…" description="Choose where each kind of notification reaches you. Changes save automatically." padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-base">
            <caption className="sr-only">Notification channels per event</caption>
            <thead className="border-b border-border-subtle bg-sunken/60">
              <tr>
                <th scope="col" className="h-10 px-5 text-left text-xs font-semibold tracking-wide text-fg-muted uppercase">
                  Event
                </th>
                <th scope="col" className="h-10 w-28 px-3 text-center text-xs font-semibold tracking-wide text-fg-muted uppercase">
                  <span className="inline-flex items-center gap-1">
                    <Bell aria-hidden className="size-3.5" /> In-app
                  </span>
                </th>
                <th scope="col" className="h-10 w-28 px-3 text-center text-xs font-semibold tracking-wide text-fg-muted uppercase">
                  <span className="inline-flex items-center gap-1">
                    <Mail aria-hidden className="size-3.5" /> Email
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {NOTIFICATION_EVENTS.map((event) => {
                const channels = prefs.notifications[event.key] ?? DEFAULT_CHANNELS;
                return (
                  <tr key={event.key} className="border-b border-border-subtle last:border-b-0 hover:bg-hover">
                    <th scope="row" className="px-5 py-3 text-left font-normal">
                      <span className="block font-medium text-fg">{event.label}</span>
                      <span className="block text-sm text-fg-muted">{event.description}</span>
                    </th>
                    <td className="px-3 py-3 text-center">
                      <Switch
                        className="mx-auto"
                        aria-label={`${event.label}: in-app`}
                        checked={channels.inApp}
                        onCheckedChange={(value) => toggle(event.key, 'inApp', value)}
                        data-testid={`notif-${event.key}-inApp`}
                      />
                    </td>
                    <td className="px-3 py-3 text-center">
                      <Switch
                        className="mx-auto"
                        aria-label={`${event.label}: email`}
                        checked={channels.email}
                        onCheckedChange={(value) => toggle(event.key, 'email', value)}
                        data-testid={`notif-${event.key}-email`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SettingsCard>
      <SettingsCard title="Delivery" description="Bundle email and pause notifications outside working hours.">
        <SettingRow label="Email frequency" description="Instant sends each email as it happens.">
          <Select
            aria-label="Email frequency"
            value={prefs.emailDigest}
            onValueChange={(value) =>
              update.mutate(
                { emailDigest: value as ProfileDto['prefs']['emailDigest'] },
                { onSuccess: () => toast.success('Email frequency saved') },
              )
            }
            options={[
              { value: 'instant', label: 'Instantly' },
              { value: 'daily', label: 'Daily digest' },
              { value: 'weekly', label: 'Weekly digest' },
              { value: 'off', label: 'Never email me' },
            ]}
          />
        </SettingRow>
        <SettingRow label="Quiet hours" description="No pushes or emails between these times (your time zone).">
          <div className="flex flex-wrap items-center gap-3">
            <Switch
              aria-label="Enable quiet hours"
              checked={prefs.quietHours.enabled}
              onCheckedChange={(enabled) =>
                update.mutate(
                  { quietHours: { ...hours, enabled } },
                  { onSuccess: () => toast.success(enabled ? 'Quiet hours on' : 'Quiet hours off') },
                )
              }
            />
            <label className="flex items-center gap-2 text-sm text-fg-secondary">
              From
              <Input
                type="time"
                size="sm"
                containerClassName="w-28"
                aria-label="Quiet hours start"
                disabled={!prefs.quietHours.enabled}
                value={hours.from}
                onChange={(event) => setQuiet({ ...hours, from: event.target.value })}
                onBlur={() => quiet && update.mutate({ quietHours: { enabled: true, ...hours } })}
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-fg-secondary">
              To
              <Input
                type="time"
                size="sm"
                containerClassName="w-28"
                aria-label="Quiet hours end"
                disabled={!prefs.quietHours.enabled}
                value={hours.to}
                onChange={(event) => setQuiet({ ...hours, to: event.target.value })}
                onBlur={() => quiet && update.mutate({ quietHours: { enabled: true, ...hours } })}
              />
            </label>
          </div>
        </SettingRow>
      </SettingsCard>
    </div>
  );
}
