'use client';
/** The shared app switcher, from Ledger. Ledger is the current row; the other apps link out. */
import { AppSwitcher } from '@kitstak/ui/app-switcher';
import type { ShellAppUrls } from './shell-context';

export function LedgerAppSwitcher({ urls, modules }: { readonly urls: ShellAppUrls; readonly modules: { readonly crm: boolean; readonly wms: boolean; readonly projects: boolean; readonly pulse: boolean } }) {
  return <AppSwitcher current="ledger" urls={{ portal: urls.portal, crm: urls.crm, wms: urls.wms, projects: urls.projects, pulse: urls.pulse }} entitled={modules} />;
}
