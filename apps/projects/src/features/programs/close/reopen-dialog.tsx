'use client';
/** Reopen a closed month (docs/programs/SPEC.md 5.20): owners only, a reason is required. */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { LockOpen } from 'lucide-react';
import { Button, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, Field, Textarea } from '@/components/ui';
import { useServerAction } from '@/lib/hooks/use-action';
import { qk } from '@/lib/query-keys';
import type { IsoMonth } from '@/lib/program-types';
import { reopenMonthAction } from '@/server/actions/program-closes';
import { useCurrentProgram } from '../program-context';
import { monthShortName } from '../overview/overview-model';

export function ReopenMonthDialog({ month, open, onOpenChange }: { readonly month: IsoMonth; readonly open: boolean; readonly onOpenChange: (open: boolean) => void }) {
  const { key } = useCurrentProgram();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const name = monthShortName(month);
  const reopen = useServerAction(reopenMonthAction, {
    successMessage: `${name} is open again for ${key}.`,
    errorTitle: `Couldn't reopen ${name}`,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.program(key) });
      await queryClient.invalidateQueries({ queryKey: ['programs'] });
      onOpenChange(false);
    },
  });
  const error = tried && !reason.trim() ? 'Say why the month is reopened. It is saved in Activity.' : null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" data-testid="reopen-dialog">
        <DialogHeader
          icon={
            <span className="flex size-9 items-center justify-center rounded-lg bg-warning-subtle text-warning-text">
              <LockOpen aria-hidden className="size-4" />
            </span>
          }
          title={`Reopen ${name}?`}
          description="Output, prices and fees on its days can change again until you close it once more."
        />
        <DialogBody>
          <Field label="Reason" required error={error}>
            {({ inputId, invalid }) => <Textarea id={inputId} autoFocus value={reason} onChange={(event) => setReason(event.target.value)} rows={3} maxLength={1000} invalid={invalid} placeholder="A late credit for torn liners needs to go on this month." />}
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={reopen.pending}
            onClick={() => {
              setTried(true);
              if (reason.trim()) void reopen.run({ key, month, reason: reason.trim() });
            }}
            data-testid="reopen-confirm"
          >
            Reopen {name}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
