import { getUserPrefs, integrationLinkSummary, listSpaces } from '@/server/domain';
import { pageContext } from '@/server/page';
import { SettingsView } from './settings-view';

export async function SettingsPage() {
  const { ctx } = await pageContext('/settings');
  const [spaces, prefs, summary] = await Promise.all([
    listSpaces(ctx),
    getUserPrefs(ctx),
    integrationLinkSummary(ctx),
  ]);
  return (
    <SettingsView
      spaces={spaces}
      notificationPrefs={prefs.notifications ?? {}}
      integrationSummary={summary}
    />
  );
}
