'use client';
/** The shared app switcher, for Crew. Crew is the current row; the other apps link out. */
import { AppSwitcher } from '@kitstak/ui/app-switcher';
import type { ShellContextValue } from './shell-context';

export function CrewAppSwitcher({ appUrls, modules }: Pick<ShellContextValue, 'appUrls' | 'modules'>) {
  return (
    <AppSwitcher
      current="crew"
      urls={{ portal: appUrls.portal, crm: appUrls.crm, wms: appUrls.wms, projects: appUrls.projects, pulse: appUrls.pulse }}
      entitled={modules}
      notInPlan={[]}
    />
  );
}
