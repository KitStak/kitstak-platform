'use client';
/** Profile → Preferences: theme (applied instantly), language, date / time formats, week start. */
import { Monitor, Moon, Sun } from 'lucide-react';
import { Select, toast, ToggleGroup } from '@/components/ui';
import { useTheme, type ThemePreference } from '@/features/shell/theme';
import { DATE_FORMATS, LOCALES, type ProfileDto, type UpdateProfileInput } from '@/server/services/admin-contracts';
import { useUpdateProfile } from '../api';
import { SettingRow, SettingsCard, SettingsSkeleton } from '../ui';

const DATE_EXAMPLE: Readonly<Record<(typeof DATE_FORMATS)[number], string>> = {
  MDY: 'MM/DD/YYYY · 11/05/2026',
  DMY: 'DD/MM/YYYY · 05/11/2026',
  YMD: 'YYYY-MM-DD · 2026-11-05',
};

/** "2:30 PM" vs "14:30" preview of the current time. */
function timePreview(format: '12h' | '24h'): string {
  return new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: format === '12h' });
}

export function PreferencesTab({ profile }: { readonly profile: ProfileDto | undefined }) {
  const update = useUpdateProfile();
  const { preference, setPreference } = useTheme();
  if (!profile) {
    return (
      <SettingsCard title="Appearance">
        <SettingsSkeleton rows={4} />
      </SettingsCard>
    );
  }
  const prefs = profile.prefs;
  const save = (patch: UpdateProfileInput) => update.mutate(patch, { onSuccess: () => toast.success('Preferences saved') });

  return (
    <div className="flex flex-col gap-6" data-testid="profile-preferences">
      <SettingsCard title="Appearance" description="Applies right away on this device and follows you to new ones.">
        <SettingRow label="Theme" description="System follows your operating system’s light or dark setting.">
          <ToggleGroup<ThemePreference>
            label="Theme"
            value={preference}
            onValueChange={(theme) => {
              setPreference(theme);
              save({ theme });
            }}
            options={[
              { value: 'light', label: 'Light', icon: <Sun aria-hidden /> },
              { value: 'dark', label: 'Dark', icon: <Moon aria-hidden /> },
              { value: 'system', label: 'System', icon: <Monitor aria-hidden /> },
            ]}
          />
        </SettingRow>
      </SettingsCard>
      <SettingsCard title="Language & region" description="How dates, times and numbers are shown to you.">
        <SettingRow label="Language" description="Interface language and number formatting.">
          <Select
            aria-label="Language"
            value={prefs.locale}
            onValueChange={(locale) => save({ locale })}
            options={LOCALES.map((locale) => ({ value: locale.value, label: locale.label }))}
          />
        </SettingRow>
        <SettingRow label="Date format">
          <Select
            aria-label="Date format"
            value={prefs.dateFormat}
            onValueChange={(value) => save({ dateFormat: value as (typeof DATE_FORMATS)[number] })}
            options={DATE_FORMATS.map((format) => ({ value: format, label: DATE_EXAMPLE[format] }))}
          />
        </SettingRow>
        <SettingRow label="Time format" description={`Now: ${timePreview(prefs.timeFormat)}`}>
          <ToggleGroup<'12h' | '24h'>
            label="Time format"
            value={prefs.timeFormat}
            onValueChange={(timeFormat) => save({ timeFormat })}
            options={[
              { value: '12h', label: '12-hour' },
              { value: '24h', label: '24-hour' },
            ]}
          />
        </SettingRow>
        <SettingRow label="Week starts on" description="Used by calendars, timelines and date pickers.">
          <ToggleGroup<'sunday' | 'monday'>
            label="Week starts on"
            value={prefs.weekStart}
            onValueChange={(weekStart) => save({ weekStart })}
            options={[
              { value: 'sunday', label: 'Sunday' },
              { value: 'monday', label: 'Monday' },
            ]}
          />
        </SettingRow>
      </SettingsCard>
    </div>
  );
}
