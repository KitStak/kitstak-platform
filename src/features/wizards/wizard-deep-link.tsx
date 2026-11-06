'use client';
/**
 * Deep links into wizards: `?wizard=templates|new-board|workspace|folder|invite` (optionally
 * `&template=<id>`) on any app URL opens the wizard, then the parameter is removed so a reload
 * or Back does not reopen it. Mount once inside the app shell.
 */
import { Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useOpenWizard } from './use-open-wizard';

const TEMPLATE_ID = /^[a-z0-9-]{1,64}$/;

function DeepLinkEffect() {
  const params = useSearchParams();
  const open = useOpenWizard();
  const wizard = params.get('wizard');
  const template = params.get('template');

  useEffect(() => {
    if (!wizard) return;
    // Strip the params first with history.replaceState: Next keeps useSearchParams in sync, it
    // costs no server round trip, and a reload or Back never reopens the wizard.
    const url = new URL(window.location.href);
    url.searchParams.delete('wizard');
    url.searchParams.delete('template');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    const templateId = template && TEMPLATE_ID.test(template) ? template : undefined;
    if (wizard === 'templates') open.templates({ templateId });
    else if (wizard === 'new-board') open.createBoard();
    else if (wizard === 'workspace') open.workspace();
    else if (wizard === 'folder') open.folder();
    else if (wizard === 'invite') open.invite();
  }, [wizard, template, open]);

  return null;
}

export function WizardDeepLink() {
  return (
    <Suspense fallback={null}>
      <DeepLinkEffect />
    </Suspense>
  );
}
