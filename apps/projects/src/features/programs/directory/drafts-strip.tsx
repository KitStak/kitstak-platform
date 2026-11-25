'use client';
/**
 * The drafts strip under the directory header (docs/programs/SPEC.md 5.3): "You have 2 program
 * drafts" with a chip per draft (title, "Step 3 of 6", saved "2 days ago") that resumes it, and a
 * menu per chip with Delete (Undo brings it back).
 */
import Link from 'next/link';
import { FileStack, MoreHorizontal, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, IconButton, cn, toast } from '@/components/ui';
import { formatRelative } from '@/lib/dates';
import { qk } from '@/lib/query-keys';
import { routes } from '@/lib/routes';
import type { WizardDraftDTO } from '@/lib/program-types';
import { deleteProgramDraftAction, saveProgramDraftAction } from '@/server/actions/programs';
import { useHydrated } from '@/features/programs/kit';

export const WIZARD_STEP_COUNT = 6;

/** True when the draft already picked how to start, so it resumes without the Start step. */
function draftSkipsStart(draft: Pick<WizardDraftDTO, 'step' | 'payload'>): boolean {
  const start = (draft.payload as { readonly start?: { readonly mode?: unknown } }).start;
  return draft.step > 0 && start !== undefined && start.mode !== null && start.mode !== undefined;
}

/**
 * "Step 3 of 6" (steps are stored from 0, Start). Counted the way the wizard's stepper counts:
 * a draft that resumes past Start shows 5 steps, so its numbers match the screen it opens.
 */
export function draftStepText(step: number, skipsStart = false): string {
  const total = skipsStart ? WIZARD_STEP_COUNT - 1 : WIZARD_STEP_COUNT;
  const number = skipsStart ? step : step + 1;
  return `Step ${Math.min(total, Math.max(1, number))} of ${total}`;
}

/** The chip text for a saved draft. */
export const draftStep = (draft: Pick<WizardDraftDTO, 'step' | 'payload'>): string => draftStepText(draft.step, draftSkipsStart(draft));

export function DraftsStrip({ drafts, className }: { readonly drafts: readonly WizardDraftDTO[]; readonly className?: string }) {
  const hydrated = useHydrated();
  const queryClient = useQueryClient();
  const remove = async (draft: WizardDraftDTO) => {
    queryClient.setQueryData<WizardDraftDTO[]>(qk.programDrafts(), (old) => (old ?? []).filter((entry) => entry.id !== draft.id));
    const result = await deleteProgramDraftAction({ id: draft.id });
    if (!result.ok) {
      toast.error("Couldn't delete the draft", result.error.message);
      void queryClient.invalidateQueries({ queryKey: qk.programDrafts() });
      return;
    }
    toast.undo(`Deleted the draft ${draft.title || 'Untitled program'}`, {
      onUndo: async () => {
        const back = await saveProgramDraftAction({ title: draft.title, step: draft.step, payload: { ...draft.payload } });
        if (!back.ok) throw new Error(back.error.message);
        await queryClient.invalidateQueries({ queryKey: qk.programDrafts() });
      },
    });
  };
  return (
    <section className={cn('flex flex-wrap items-center gap-2 rounded-xl border border-border-subtle bg-sunken px-3 py-2', className)} aria-label="Program drafts" data-testid="drafts-strip">
      <span className="flex items-center gap-1.5 text-sm font-medium text-fg">
        <FileStack aria-hidden className="size-4 text-icon" />
        You have {drafts.length} program {drafts.length === 1 ? 'draft' : 'drafts'}
      </span>
      <ul className="flex min-w-0 flex-wrap items-center gap-1.5">
        {drafts.slice(0, 6).map((draft) => (
          <li key={draft.id} className="flex min-h-7 max-w-full items-center rounded-md border border-border-subtle bg-panel shadow-xs sm:max-w-[440px]">
            <Link
              href={routes.newProgram({ draft: draft.id })}
              title={`${draft.title || 'Untitled program'}, ${draftStep(draft).toLowerCase()}`}
              className="flex min-w-0 flex-wrap items-center gap-x-1.5 rounded-l-md py-1 pr-1 pl-2.5 text-xs outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus sm:flex-nowrap"
              data-testid="draft-chip"
            >
              {/* The title keeps its room; the step and saved time give way first. */}
              <span className="max-w-full min-w-0 shrink-0 truncate font-medium text-fg max-sm:basis-full sm:max-w-[220px]">{draft.title || 'Untitled program'}</span>
              <span aria-hidden className="text-fg-muted max-sm:hidden">·</span>
              <span className="shrink-0 whitespace-nowrap text-fg-secondary">{draftStep(draft)}</span>
              <span aria-hidden className="text-fg-muted">·</span>
              <span className="min-w-0 truncate text-fg-muted" suppressHydrationWarning>{hydrated ? `saved ${formatRelative(draft.updatedAt)}` : 'saved'}</span>
            </Link>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton size="sm" label={`More for the draft ${draft.title || 'Untitled program'}`} icon={<MoreHorizontal aria-hidden />} className="size-6" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem icon={<Trash2 aria-hidden />} variant="danger" onSelect={() => void remove(draft)}>
                  Delete draft
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        ))}
        {drafts.length > 6 ? <li className="text-xs text-fg-muted">and {drafts.length - 6} more in New program, Resume a draft</li> : null}
      </ul>
    </section>
  );
}
