'use client';
import type { RefObject } from 'react';
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader } from '@/components/ui';

export interface KeepProgressDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onKeep: () => void;
  readonly onDiscard: () => void;
  /** Focus goes back here when the dialog closes (Escape / outside click). */
  readonly returnFocus: RefObject<HTMLElement | null>;
}

export function KeepProgressDialog({ open, onOpenChange, onKeep, onDiscard, returnFocus }: KeepProgressDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="sm"
        hideClose
        data-testid="import-keep-dialog"
        onCloseAutoFocus={(event) => {
          const target = returnFocus.current;
          if (target && target.isConnected) {
            event.preventDefault();
            target.focus();
          }
        }}
      >
        <DialogHeader
          title="Keep your progress?"
          description="Your file and column mapping stay here until you come back. Discard to start over."
        />
        <DialogFooter className="border-t-0 pt-2">
          <Button variant="danger-ghost" onClick={onDiscard}>
            Discard
          </Button>
          <Button onClick={onKeep} autoFocus>
            Keep progress
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
