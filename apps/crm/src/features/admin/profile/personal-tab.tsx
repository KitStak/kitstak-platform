'use client';
/** Profile → Personal info: click-to-edit identity rows and time zone. */
import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { BadgeCheck, Briefcase, Camera, Clock3, Mail, MapPin, Phone, Trash2, UserRound } from 'lucide-react';
import { Button, Combobox, toast } from '@/components/ui';
import type { ProfileDto } from '@/server/services/admin-contracts';
import { useUpdateProfile } from '../api';
import { ROLE_LABEL } from '../format';
import { SettingsCard, SettingsSkeleton } from '../ui';
import { EditableRow } from './editable-row';
import { refreshSessionCache } from './session-cache';

const PHONE_RE = /^[+()\d\s.-]{5,32}$/;

function timeZones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['UTC', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Tokyo'];
  }
}

function zoneLabel(zone: string): string {
  try {
    const offset = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' })
      .formatToParts(new Date())
      .find((part) => part.type === 'timeZoneName')?.value;
    return `${zone.replace(/_/g, ' ')}${offset ? ` (${offset})` : ''}`;
  } catch {
    return zone;
  }
}

export function PersonalTab({ profile }: { readonly profile: ProfileDto | undefined }) {
  const router = useRouter();
  const update = useUpdateProfile();
  const zones = useMemo(() => timeZones().map((zone) => ({ value: zone, label: zoneLabel(zone) })), []);
  const detected = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return null;
    }
  }, []);

  if (!profile) {
    return (
      <SettingsCard title="Personal info">
        <SettingsSkeleton rows={5} />
      </SettingsCard>
    );
  }

  const save = (patch: Parameters<typeof update.mutateAsync>[0], label: string, refresh = false) =>
    update.mutateAsync(patch).then(async () => {
      toast.success(`${label} saved`);
      if (refresh) {
        await refreshSessionCache();
        router.refresh();
      }
    });

  return (
    <div className="flex flex-col gap-6">
      <SettingsCard
        title="Personal info"
        testId="profile-personal"
      >
        <div className="grid gap-1 border-b border-border-subtle pb-3 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-center sm:gap-6" data-testid="profile-photo-row">
          <span className="flex items-center gap-2 text-sm font-medium text-fg-secondary">
            <Camera aria-hidden className="size-4 text-icon" />
            Profile photo
          </span>
          <div className="flex min-h-8 flex-wrap items-center gap-3 px-2">
            <span className="text-base text-fg-secondary">
              {profile.user.image ? 'Click your picture above to replace it.' : 'Click the picture above to upload one.'}
            </span>
            {profile.user.image ? (
              <Button size="sm" variant="ghost" leadingIcon={<Trash2 aria-hidden />} onClick={() => void save({ image: null }, 'Profile photo', true)}>
                Remove photo
              </Button>
            ) : null}
          </div>
        </div>
        <EditableRow
          label="Full name"
          icon={<UserRound aria-hidden />}
          value={profile.user.name}
          placeholder="Add your name"
          validate={(value) => (value.length === 0 ? 'Your name can’t be empty' : null)}
          onSave={(name) => save({ name }, 'Name', true)}
          testId="profile-name"
        />
        <EditableRow
          label="Title"
          icon={<Briefcase aria-hidden />}
          value={profile.user.title}
          placeholder="e.g. Account Executive"
          onSave={(title) => save({ title: title || null }, 'Title', true)}
          testId="profile-title"
        />
        <EditableRow label="Email" icon={<Mail aria-hidden />} value={profile.user.email} placeholder="" readOnly readOnlyHint="Used to sign in" />
        <EditableRow
          label="Phone"
          icon={<Phone aria-hidden />}
          type="tel"
          maxLength={32}
          value={profile.prefs.phone}
          placeholder="Add a phone number"
          validate={(value) => (value === '' || PHONE_RE.test(value) ? null : 'Use digits, spaces and + ( ) - only')}
          onSave={(phone) => save({ phone: phone || null }, 'Phone')}
          testId="profile-phone"
        />
        <EditableRow
          label="Location"
          icon={<MapPin aria-hidden />}
          value={profile.prefs.location}
          placeholder="City, country"
          onSave={(location) => save({ location: location || null }, 'Location')}
        />
        <div className="grid gap-1 border-b border-border-subtle py-3 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-center sm:gap-6">
          <span className="flex items-center gap-2 text-sm font-medium text-fg-secondary">
            <Clock3 aria-hidden className="size-4 text-icon" />
            Time zone
          </span>
          <div className="flex flex-col gap-1">
            <Combobox
              aria-label="Time zone"
              value={profile.user.timezone}
              placeholder="Choose your time zone"
              searchPlaceholder="Search cities or regions"
              options={zones}
              onValueChange={(timezone) => void save({ timezone }, 'Time zone')}
            />
            {detected && detected !== profile.user.timezone ? (
              <button
                type="button"
                onClick={() => void save({ timezone: detected }, 'Time zone')}
                className="self-start rounded-sm text-sm text-fg-link hover:underline focus-visible:outline-2 focus-visible:outline-focus"
              >
                Use this device’s time zone ({detected.replace(/_/g, ' ')})
              </button>
            ) : null}
          </div>
        </div>
        <EditableRow
          label="Role"
          icon={<BadgeCheck aria-hidden />}
          value={ROLE_LABEL[profile.role]}
          placeholder=""
          readOnly
          readOnlyHint="Set by an admin"
        />
      </SettingsCard>
    </div>
  );
}
