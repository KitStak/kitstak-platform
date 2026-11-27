'use client';
/**
 * "Delete this job?": says in plain words what will leave the reports (the job's revenue and
 * labor hours) and where to get the job back, before anything is deleted.
 */
import { ConfirmDialog } from '@/components/ui';
import { deleteJobWarning } from './delete-job-words';
import type { useJobActions } from './use-job-actions';

export function DeleteJobDialog({ actions }: { readonly actions: ReturnType<typeof useJobActions> }) {
  const job = actions.deleting;
  return (
    <ConfirmDialog
      open={job !== null}
      onOpenChange={(open) => {
        if (!open && !actions.busy) actions.cancelRemove();
      }}
      title={job ? `Delete ${job.number}: ${job.name}?` : 'Delete this job?'}
      description={
        job ? (
          <span data-testid="delete-job-warning">
            {deleteJobWarning(job)} You can bring it back from the Deleted tab on the Jobs page.
          </span>
        ) : undefined
      }
      confirmLabel="Delete job"
      cancelLabel="Keep the job"
      destructive
      loading={actions.busy}
      onConfirm={() => void actions.confirmRemove()}
    />
  );
}
