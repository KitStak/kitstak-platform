'use client';
/**
 * Board-level import: `<ImportDialog boardId={id} open={open} onOpenChange={setOpen} />`.
 * The destination is locked to the board (the user still picks the group). Closing keeps the
 * draft, so reopening the dialog resumes where the user left off.
 */
import { Suspense } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Dialog, DialogContent, Skeleton, VisuallyHidden } from '@/components/ui';
import { ImportWizard } from './import-wizard';

export interface ImportDialogProps {
  readonly boardId?: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function ImportDialog({ boardId, open, onOpenChange }: ImportDialogProps) {
  const scope = boardId ? `board:${boardId}` : 'dialog';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="xl"
        className="h-[min(760px,calc(100dvh-48px))] overflow-hidden p-0"
        aria-describedby={undefined}
        data-testid="import-dialog"
      >
        <VisuallyHidden>
          <DialogPrimitive.Title>Import data</DialogPrimitive.Title>
        </VisuallyHidden>
        <div className="flex min-h-0 flex-1 flex-col pt-1">
          <Suspense fallback={<Skeleton height={200} rounded="lg" className="m-6" />}>
            <ImportWizard
              scope={scope}
              variant="dialog"
              lockedBoardId={boardId ?? null}
              onExit={() => onOpenChange(false)}
            />
          </Suspense>
        </div>
      </DialogContent>
    </Dialog>
  );
}
