import type { Metadata } from 'next';
import { SettingsTab } from '@/features/programs/settings/settings-tab';

export const metadata: Metadata = { title: 'Settings' };

/** Program Settings tab (docs/programs/SPEC.md 5.16). The frame hides the tab without `project:update`. */
export default function Page() {
  return <SettingsTab />;
}
