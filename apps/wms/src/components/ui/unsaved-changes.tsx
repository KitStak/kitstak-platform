'use client';

import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useBeforeUnload, useNavigationGuard } from '@/lib/use-unsaved-changes';
import { ConfirmDialog } from './confirm-dialog';

export const UNSAVED_TITLE = 'You have unsaved changes';
export const UNSAVED_DESCRIPTION =
  'If you leave now, the changes you made will be lost. Do you want to leave?';

/** Red-header guard (0.3): "Leave" is the destructive danger action; "Stay" has focus. */
export function UnsavedChangesDialog({
  open,
  onStay,
  onLeave,
}: {
  readonly open: boolean;
  readonly onStay: () => void;
  readonly onLeave: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onStay();
      }}
      variant="danger"
      icon={AlertTriangle}
      title={UNSAVED_TITLE}
      description={UNSAVED_DESCRIPTION}
      cancelLabel="Stay"
      confirmLabel="Leave"
      onConfirm={onLeave}
    />
  );
}

/** Mount inside any dirty form/page: blocks reloads and in-app link navigation. */
export function UnsavedChangesGuard({ when }: { readonly when: boolean }) {
  useBeforeUnload(when);
  const guard = useNavigationGuard(when);
  return (
    <UnsavedChangesDialog open={guard.pendingHref !== null} onStay={guard.cancel} onLeave={guard.proceed} />
  );
}
