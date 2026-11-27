import { RouteTabs } from '@/components/pulse/route-tabs';
import { routes } from '@/lib/routes';

export type SettingsTab = 'all' | 'close' | 'apps' | 'audit';

/** The four tabs of Settings. Month close and Connected apps render the same tabs from their own folders. */
export function SettingsTabs({ active }: { readonly active: SettingsTab }) {
  return (
    <RouteTabs
      label="Settings sections"
      active={active}
      tabs={[
        { id: 'all', label: 'Workspace', href: routes.settings() },
        { id: 'close', label: 'Month close', href: routes.settingsClose() },
        { id: 'apps', label: 'Connected apps', href: routes.settingsApps() },
        { id: 'audit', label: 'Audit log', href: routes.settingsAudit() },
      ]}
    />
  );
}
