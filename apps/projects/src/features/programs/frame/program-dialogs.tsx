'use client';
/**
 * Dialogs opened from the program menu (docs/programs/SPEC.md 5.5): Save as template, Post an
 * update, End program, Archive and Delete (typed key). Each one calls a real server action and
 * refreshes the program cache.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarX2, LayoutTemplate, Megaphone, Trash2 } from 'lucide-react';
import { Button, ConfirmDialog, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, Field, Input, IsoDatePicker, Textarea, cn } from '@/components/ui';
import { useServerAction } from '@/lib/hooks/use-action';
import { qk } from '@/lib/query-keys';
import { routes } from '@/lib/routes';
import type { ProgramDetailDTO } from '@/lib/program-types';
import { archiveProgramAction, deleteProgramAction, postProgramUpdateAction, saveProgramTemplateAction, setProgramStatusAction } from '@/server/actions/programs';
import { StatusUpdateComposer } from '@/features/projects/status-updates-panel';

export type ProgramDialog = 'template' | 'update' | 'end' | 'archive' | 'delete' | null;

function DialogIcon({ children, tone = 'neutral' }: { readonly children: React.ReactNode; readonly tone?: 'neutral' | 'danger' }) {
  return <span className={cn('flex size-9 items-center justify-center rounded-lg', tone === 'danger' ? 'bg-danger-subtle text-danger-text' : 'bg-sunken text-icon')}>{children}</span>;
}

function useProgramRefresh(key: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: qk.program(key) });
    void queryClient.invalidateQueries({ queryKey: ['programs'] });
  };
}

export function SaveTemplateDialog({ program, open, onOpenChange }: { readonly program: ProgramDetailDTO; readonly open: boolean; readonly onOpenChange: (open: boolean) => void }) {
  const [name, setName] = useState(`${program.name} template`);
  const [description, setDescription] = useState('');
  const save = useServerAction(saveProgramTemplateAction, {
    successMessage: `Template saved. Start a program from it in New program.`,
    errorTitle: "Couldn't save the template",
    invalidate: [qk.programTemplates()],
    onSuccess: () => onOpenChange(false),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" data-testid="program-template-dialog">
        <DialogHeader icon={<DialogIcon><LayoutTemplate aria-hidden className="size-4" /></DialogIcon>} title="Save as template" description="Keeps the variants, price card lines, rules and schedules. Dates, output and links are left out." />
        <DialogBody className="flex flex-col gap-4 pb-4">
          <Field label="Template name" required>
            {(ids) => <Input id={ids.inputId} value={name} onChange={(event) => setName(event.target.value)} maxLength={120} autoFocus />}
          </Field>
          <Field label="Description" hint="Optional. Shown in the template gallery.">
            {(ids) => <Textarea id={ids.inputId} value={description} onChange={(event) => setDescription(event.target.value)} rows={3} maxLength={2000} />}
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={save.pending} disabled={!name.trim()} onClick={() => void save.run({ key: program.key, name: name.trim(), description: description.trim() || null })}>
            Save template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PostUpdateDialog({ program, open, onOpenChange }: { readonly program: ProgramDetailDTO; readonly open: boolean; readonly onOpenChange: (open: boolean) => void }) {
  const refresh = useProgramRefresh(program.key);
  const post = useServerAction(postProgramUpdateAction, {
    successMessage: 'Update posted. Members will see it in their inbox.',
    errorTitle: "Couldn't post the update",
    onSuccess: () => {
      refresh();
      onOpenChange(false);
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="program-update-dialog">
        <DialogHeader icon={<DialogIcon><Megaphone aria-hidden className="size-4" /></DialogIcon>} title={`Post an update on ${program.key}`} description="Say how the program is going. It shows on the Overview and in members' inboxes." />
        <DialogBody className="pb-6">
          <StatusUpdateComposer
            autoFocus
            initialHealth={program.health ?? 'on_track'}
            notePlaceholder="How did this week go? Anything blocking the floor? What is next?"
            pending={post.pending}
            onCancel={() => onOpenChange(false)}
            onSubmit={async ({ health, note }) => {
              if (!note) return false;
              return Boolean(await post.run({ key: program.key, health, body: note }));
            }}
          />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

export function EndProgramDialog({ program, open, onOpenChange }: { readonly program: ProgramDetailDTO; readonly open: boolean; readonly onOpenChange: (open: boolean) => void }) {
  const today = program.calendar.today;
  const [endsOn, setEndsOn] = useState<string | null>(program.endDate ?? today);
  const [futureBuilds, setFutureBuilds] = useState<'cancel' | 'keep'>('cancel');
  const refresh = useProgramRefresh(program.key);
  const end = useServerAction(setProgramStatusAction, {
    successMessage: `${program.key} ends on the date you chose.`,
    errorTitle: "Couldn't end the program",
    onSuccess: () => {
      refresh();
      onOpenChange(false);
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" data-testid="program-end-dialog">
        <DialogHeader icon={<DialogIcon><CalendarX2 aria-hidden className="size-4" /></DialogIcon>} title={`End ${program.name}`} description="Sets an end date. Schedules stop making builds after it." />
        <DialogBody className="flex flex-col gap-4 pb-4">
          <Field label="Last day" required hint="Output can still be logged up to this day.">
            {(ids) => <IsoDatePicker id={ids.inputId} value={endsOn} onChange={setEndsOn} />}
          </Field>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium text-fg">Planned builds after the last day</legend>
            {(
              [
                ['cancel', 'Cancel them', 'Builds with no output are cancelled. Builds with output stay.'],
                ['keep', 'Keep them', 'They stay planned so you can move or finish them.'],
              ] as const
            ).map(([value, label, help]) => (
              <label key={value} className={cn('flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5', futureBuilds === value ? 'border-primary bg-primary-subtle/40' : 'border-border-subtle hover:border-border-default')}>
                <input type="radio" name="future-builds" value={value} checked={futureBuilds === value} onChange={() => setFutureBuilds(value)} className="mt-0.5 accent-[var(--primary)]" />
                <span className="flex flex-col">
                  <span className="text-sm font-medium text-fg">{label}</span>
                  <span className="text-xs text-fg-muted">{help}</span>
                </span>
              </label>
            ))}
          </fieldset>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Keep running
          </Button>
          <Button variant="danger" loading={end.pending} disabled={!endsOn} onClick={() => void end.run({ key: program.key, status: 'completed', endsOn, futureBuilds })}>
            End program
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ArchiveProgramDialog({ program, open, onOpenChange }: { readonly program: ProgramDetailDTO; readonly open: boolean; readonly onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const refresh = useProgramRefresh(program.key);
  const archive = useServerAction(archiveProgramAction, {
    successMessage: `${program.key} was archived. Find it under Archived in Programs.`,
    errorTitle: "Couldn't archive the program",
    onSuccess: () => {
      refresh();
      onOpenChange(false);
      router.push(routes.programs());
    },
  });
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Archive ${program.name}?`}
      description="It leaves the sidebar and Floor today. Its builds, output and statements stay, and you can restore it later."
      confirmLabel="Archive program"
      loading={archive.pending}
      onConfirm={() => void archive.run({ key: program.key })}
    />
  );
}

export function DeleteProgramDialog({ program, open, onOpenChange }: { readonly program: ProgramDetailDTO; readonly open: boolean; readonly onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [typed, setTyped] = useState('');
  const refresh = useProgramRefresh(program.key);
  const remove = useServerAction(deleteProgramAction, {
    successMessage: `${program.key} was deleted.`,
    errorTitle: "Couldn't delete the program",
    onSuccess: () => {
      refresh();
      onOpenChange(false);
      router.push(routes.programs());
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" role="alertdialog" data-testid="program-delete-dialog">
        <DialogHeader icon={<DialogIcon tone="danger"><Trash2 aria-hidden className="size-4" /></DialogIcon>} title={`Delete ${program.name}?`} description="Its builds, variants, price card and schedules are deleted with it. This only works when no month is closed." />
        <DialogBody className="pb-4">
          <Field label={<span>Type <span className="font-key font-semibold">{program.key}</span> to confirm</span>}>
            {(ids) => <Input id={ids.inputId} value={typed} onChange={(event) => setTyped(event.target.value.toUpperCase())} autoComplete="off" className="font-key" data-testid="program-delete-key" />}
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" autoFocus onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="danger" leadingIcon={<Trash2 aria-hidden />} loading={remove.pending} disabled={typed !== program.key} onClick={() => void remove.run({ key: program.key })}>
            Delete program
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Renders whichever program dialog is open. */
export function ProgramDialogs({ program, open, onOpenChange }: { readonly program: ProgramDetailDTO; readonly open: ProgramDialog; readonly onOpenChange: (dialog: ProgramDialog) => void }) {
  const close = (next: boolean) => {
    if (!next) onOpenChange(null);
  };
  return (
    <>
      {open === 'template' ? <SaveTemplateDialog program={program} open onOpenChange={close} /> : null}
      {open === 'update' ? <PostUpdateDialog program={program} open onOpenChange={close} /> : null}
      {open === 'end' ? <EndProgramDialog program={program} open onOpenChange={close} /> : null}
      {open === 'archive' ? <ArchiveProgramDialog program={program} open onOpenChange={close} /> : null}
      {open === 'delete' ? <DeleteProgramDialog program={program} open onOpenChange={close} /> : null}
    </>
  );
}

