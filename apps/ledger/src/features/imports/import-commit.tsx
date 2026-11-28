'use client';
/** Step 3 of an import (SPEC 7): bring the checked rows in, all or nothing, or skipping the rows with problems. */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Checkbox, toast } from '@/components/ui';
import { commitImportAction } from '@/server/actions/imports';

export function ImportCommit({ batchId, errors, writes }: { readonly batchId: string; readonly errors: number; readonly writes: number }) {
  const router = useRouter();
  const [skip, setSkip] = useState(false);
  const [pending, startTransition] = useTransition();
  const blocked = errors > 0 && !skip;
  const commit = () =>
    startTransition(async () => {
      const result = await commitImportAction({ batchId, skipBadRows: skip });
      if (!result.ok) {
        toast.error('Nothing was saved', result.error.message);
        router.refresh();
        return;
      }
      const { create, update, error } = result.data;
      toast.success('Import done', `${create} new, ${update} changed${error > 0 ? `, ${error} skipped` : ''}.`);
      router.refresh();
    });
  return (
    <div className="flex flex-col gap-3" data-testid="import-commit">
      {errors > 0 ? (
        <Checkbox
          checked={skip}
          onCheckedChange={(next) => setSkip(next === true)}
          label={`Skip the ${errors} row${errors === 1 ? '' : 's'} with a problem`}
          description="Leave it off to bring in nothing until the file is fixed."
          data-testid="import-skip"
        />
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={commit} loading={pending} disabled={blocked || writes === 0} data-testid="import-commit-button">
          {writes === 0 ? 'Nothing to bring in' : `Bring in ${writes} row${writes === 1 ? '' : 's'}`}
        </Button>
        {blocked ? <span className="text-sm text-fg-secondary">Fix the rows with problems, or choose to skip them.</span> : null}
      </div>
    </div>
  );
}
