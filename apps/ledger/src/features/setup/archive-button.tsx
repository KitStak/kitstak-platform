'use client';
/**
 * Archive or bring back one record (vendor, item, tax rate, terms, account). Archiving always asks
 * first; `warning` adds a sentence, for example that Crew uses a temp agency. The server checks again.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, ConfirmDialog, toast } from '@/components/ui';
import type { ActionResult } from '@/server/actions/_action';

export interface ArchiveButtonProps {
  readonly name: string;
  readonly archived: boolean;
  /** Called with `confirmed` true once the person said yes. */
  readonly onToggle: (archive: boolean) => Promise<ActionResult<void>>;
  /** An extra sentence in the archive question. */
  readonly warning?: string;
  readonly size?: 'sm' | 'md';
  readonly testId?: string;
}

export function ArchiveButton({ name, archived, onToggle, warning, size = 'sm', testId }: ArchiveButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const run = (archive: boolean) =>
    startTransition(async () => {
      const result = await onToggle(archive);
      setOpen(false);
      if (!result.ok) {
        toast.error(archive ? `Couldn't archive ${name}` : `Couldn't bring back ${name}`, result.error.message);
        return;
      }
      toast.success(archive ? `${name} is archived` : `${name} is back`);
      router.refresh();
    });
  if (archived) {
    return (
      <Button variant="secondary" size={size} loading={pending} onClick={() => run(false)} data-testid={testId}>
        Bring back
      </Button>
    );
  }
  return (
    <>
      <Button variant="ghost" size={size} onClick={() => setOpen(true)} data-testid={testId}>
        Archive
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Archive ${name}?`}
        description={`${warning ? `${warning} ` : ''}It leaves lists and pickers. Its history stays, and you can bring it back.`}
        confirmLabel="Archive"
        destructive
        loading={pending}
        onConfirm={() => run(true)}
      />
    </>
  );
}
