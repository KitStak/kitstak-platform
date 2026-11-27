'use client';
/**
 * Program operations for the directory (docs/programs/SPEC.md 5.3 card menu and table bulk bar):
 * star, pause and resume, archive with Undo, delete behind a typed key, copy link and save as
 * template. Every change refreshes the program caches and the server rendered page.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, Field, Input, Textarea, toast } from '@/components/ui';
import type { ProgramListItemDTO } from '@/lib/program-types';
import { archiveProgramAction, deleteProgramAction, restoreProgramAction, saveProgramTemplateAction, setProgramStatusAction } from '@/server/actions/programs';
import { starProjectAction } from '@/server/actions/projects';

export function useProgramOps() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['programs'] });
    router.refresh();
  };
  const patch = (id: string, change: Partial<ProgramListItemDTO>) => {
    queryClient.setQueriesData<ProgramListItemDTO[]>({ queryKey: ['programs'] }, (old) => (Array.isArray(old) ? old.map((program) => (program.id === id ? { ...program, ...change } : program)) : old));
  };
  return {
    refresh,
    star: async (program: ProgramListItemDTO) => {
      patch(program.id, { starred: !program.starred });
      const result = await starProjectAction({ projectId: program.id, starred: !program.starred });
      if (!result.ok) {
        patch(program.id, { starred: program.starred });
        toast.error("Couldn't update the star", result.error.message);
        return;
      }
      toast.success(program.starred ? `Removed ${program.name} from Starred` : `Starred ${program.name}`);
      refresh();
    },
    setPaused: async (programs: readonly ProgramListItemDTO[], paused: boolean) => {
      const targets = programs.filter((program) => !program.archivedAt && (paused ? program.status === 'active' : program.status === 'on_hold'));
      if (targets.length === 0) {
        toast.info(paused ? 'Nothing to pause' : 'Nothing to resume', paused ? 'Only running programs can be paused.' : 'Only paused programs can be resumed.');
        return;
      }
      const results = await Promise.all(targets.map((program) => setProgramStatusAction({ key: program.key, status: paused ? 'on_hold' : 'active' })));
      const failed = results.find((result) => !result.ok);
      if (failed && !failed.ok) toast.error(paused ? "Couldn't pause every program" : "Couldn't resume every program", failed.error.message);
      const done = results.filter((result) => result.ok).length;
      refresh();
      if (done === 0) return;
      toast.undo(paused ? `Paused ${done === 1 ? targets[0]!.name : `${done} programs`}` : `Resumed ${done === 1 ? targets[0]!.name : `${done} programs`}`, {
        onUndo: async () => {
          await Promise.all(targets.map((program) => setProgramStatusAction({ key: program.key, status: paused ? 'active' : 'on_hold' })));
          refresh();
        },
      });
    },
    archive: async (programs: readonly ProgramListItemDTO[]) => {
      const targets = programs.filter((program) => !program.archivedAt);
      if (targets.length === 0) return;
      const results = await Promise.all(targets.map((program) => archiveProgramAction({ key: program.key })));
      const failed = results.find((result) => !result.ok);
      if (failed && !failed.ok) toast.error("Couldn't archive every program", failed.error.message);
      refresh();
      const done = targets.filter((_, index) => results[index]?.ok);
      if (done.length === 0) return;
      toast.undo(`Archived ${done.length === 1 ? done[0]!.name : `${done.length} programs`}`, {
        onUndo: async () => {
          await Promise.all(done.map((program) => restoreProgramAction({ key: program.key })));
          refresh();
        },
      });
    },
    restore: async (program: ProgramListItemDTO) => {
      const result = await restoreProgramAction({ key: program.key });
      if (!result.ok) {
        toast.error("Couldn't restore the program", result.error.message);
        return;
      }
      toast.success(`Restored ${program.name}`);
      refresh();
    },
    remove: async (program: ProgramListItemDTO) => {
      const result = await deleteProgramAction({ key: program.key });
      if (!result.ok) {
        toast.error("Couldn't delete the program", result.error.message);
        return false;
      }
      toast.success(`Deleted ${program.name}`, 'Its builds and output are gone from every list.');
      refresh();
      return true;
    },
    copyLink: async (program: ProgramListItemDTO) => {
      try {
        await navigator.clipboard.writeText(`${window.location.origin}/programs/${program.key}`);
        toast.success('Link copied', `Anyone in the workspace with access can open ${program.key}.`);
      } catch {
        toast.error("Couldn't copy the link", 'Your browser blocked the clipboard.');
      }
    },
  };
}

export type ProgramOps = ReturnType<typeof useProgramOps>;

/** Delete behind a typed key (owners). */
export function DeleteProgramConfirm({ program, onClose, ops }: { readonly program: ProgramListItemDTO | null; readonly onClose: () => void; readonly ops: ProgramOps }) {
  const [typed, setTyped] = useState('');
  const [pending, setPending] = useState(false);
  const open = program !== null;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setTyped('');
          onClose();
        }
      }}
    >
      <DialogContent size="sm" role="alertdialog">
        <DialogHeader title={program ? `Delete ${program.name}?` : 'Delete program'} description="This removes the program, its builds, output and price card from every list. Closed months stay in Pulse." />
        <DialogBody>
          <Field label={`Type ${program?.key ?? ''} to confirm`}>
            {({ inputId }) => <Input id={inputId} value={typed} onChange={(event) => setTyped(event.target.value.toUpperCase())} className="font-key uppercase" autoComplete="off" data-testid="delete-program-key" />}
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => { setTyped(''); onClose(); }}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={!program || typed !== program.key}
            loading={pending}
            onClick={async () => {
              if (!program) return;
              setPending(true);
              const ok = await ops.remove(program);
              setPending(false);
              if (ok) {
                setTyped('');
                onClose();
              }
            }}
          >
            Delete program
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Save as template from the card menu (program templates show in the wizard gallery). */
export function SaveProgramTemplate({ program, onClose }: { readonly program: ProgramListItemDTO | null; readonly onClose: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = name || (program ? `${program.name} template` : '');
  const close = () => {
    setName('');
    setDescription('');
    setError(null);
    onClose();
  };
  return (
    <Dialog open={program !== null} onOpenChange={(next) => (next ? null : close())}>
      <DialogContent size="sm">
        <DialogHeader title="Save as template" description="Saves the variants, price card lines, schedules and settings. Dates, output and people are left out." />
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (!program) return;
            if (!value.trim()) {
              setError('Name the template.');
              return;
            }
            setPending(true);
            const result = await saveProgramTemplateAction({ key: program.key, name: value.trim(), description: description.trim() || null });
            setPending(false);
            if (!result.ok) {
              setError(result.error.message);
              return;
            }
            toast.success('Template saved', `Pick "${value.trim()}" when you start a new program.`);
            close();
          }}
        >
          <DialogBody className="flex flex-col gap-4">
            <Field label="Template name" required error={error ?? undefined}>
              {({ inputId, invalid }) => <Input id={inputId} value={value} invalid={invalid} onChange={(event) => setName(event.target.value)} maxLength={120} autoFocus />}
            </Field>
            <Field label="Description" hint="Optional. Who it is for and how it runs.">
              {({ inputId }) => <Textarea id={inputId} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} />}
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              Save template
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
