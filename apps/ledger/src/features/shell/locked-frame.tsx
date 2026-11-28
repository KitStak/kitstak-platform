'use client';
/**
 * The frame around the preview lock screen (SPEC 3.1): the same quiet frame as every KitStak app
 * (`PlanLockFrame` in `@kitstak/ui`): the logo, the organization name and the app switcher. No
 * navigation and no "New invoice" button, because nothing can be opened in a locked app.
 */
import Link from 'next/link';
import { PlanLockFrame } from '@kitstak/ui/plan-lock';
import { LedgerAppSwitcher } from './ledger-switcher';
import { Logo } from './logo';
import type { ShellAppUrls } from './shell-context';

export interface LockedFrameProps {
  readonly orgName: string;
  readonly urls: ShellAppUrls;
  readonly modules: { readonly crm: boolean; readonly wms: boolean; readonly projects: boolean; readonly pulse: boolean };
  readonly children: React.ReactNode;
}

export function LockedFrame({ orgName, urls, modules, children }: LockedFrameProps) {
  return (
    <PlanLockFrame
      logo={
        <Link href="/" aria-label="KitStak Ledger home">
          <Logo size={24} />
        </Link>
      }
      orgName={orgName}
      switcher={<LedgerAppSwitcher urls={urls} modules={modules} />}
    >
      {children}
    </PlanLockFrame>
  );
}
