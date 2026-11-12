'use client';
import { Dialog, DialogBody, DialogContent, DialogHeader } from '@/components/ui';
import { useActivityOptions } from '../api';
import { CardSkeleton, ErrorBlock } from '../components/crm-ui';
import { ActivityComposer } from './activity-composer';

export interface LogActivityDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Contact, account or deal item the activity is logged against. */
  readonly itemId: string;
  /** Optional heading context ("Log activity for Harbor Distribution"). */
  readonly recordName?: string;
}

/**
 * Standalone "Log activity" dialog for entry points outside the CRM pages (item panel, board
 * toolbar). Creates an Activities item linked to the record's contacts/deals.
 */
export function LogActivityDialog({ open, onOpenChange, itemId, recordName }: LogActivityDialogProps) {
  const options = useActivityOptions(open ? itemId : null);
  const data = options.data;
  const name = recordName ?? data?.record.name;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="crm-log-activity-dialog">
        <DialogHeader
          title="Log activity"
          description={name ? `Record a call, email, meeting or note for ${name}.` : 'Record a call, email, meeting or note.'}
        />
        <DialogBody className="pb-6">
          {options.isError ? (
            <ErrorBlock error={options.error} onRetry={() => void options.refetch()} />
          ) : !data ? (
            <div aria-busy="true">
              <CardSkeleton rows={5} height={32} />
            </div>
          ) : !data.activityBoard ? (
            <p className="text-sm text-fg-secondary">
              There’s no Activities board you can add to. Ask an admin to add one from the CRM template.
            </p>
          ) : (
            <ActivityComposer
              autoFocus
              fromItemId={itemId}
              options={data}
              recordKey={data.record.kind === 'contacts' || data.record.kind === 'accounts' ? { kind: data.record.kind, itemId } : undefined}
              onLogged={() => onOpenChange(false)}
              onCancel={() => onOpenChange(false)}
            />
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
