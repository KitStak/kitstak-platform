'use client';
/**
 * Create board: template center (full screen) → template detail → naming step, or straight to
 * the naming step for "New board". CRM suite installs a connected workspace instead.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ArrowLeft, LayoutTemplate } from 'lucide-react';
import { Button, IconButton, DialogBody, DialogContent, DialogFooter, cn, toast } from '@/components/ui';
import type { TemplateGalleryEntry } from '@/server/services/wizards-gallery';
import { useWorkspaces } from '@/features/shell/api';
import { useCan, useOrg } from '@/features/shell/org-context';
import { routes } from '@/features/shell/routes';
import { useShellStore } from '@/features/shell/store';
import { describeError, useCreateBoardFromTemplate, useTemplateGallery, type DescribedError } from './api';
import { BoardSetupForm } from './components/board-setup-form';
import { GuardedDialog, InlineError, preventEscape } from './components/primitives';
import { SolutionInstall } from './components/solution-install';
import { StepTransition } from './components/step-transition';
import { TemplateCenter } from './components/template-center';
import {
  hasErrors,
  managingForTerminology,
  managingOption,
  rememberPrivacy,
  rememberedPrivacy,
  resolveTemplateId,
  terminologyFor,
  validateBoardSetup,
  type BoardSetupErrors,
  type BoardSetupState,
} from './model/board-setup';
import { navForTemplateId, type GalleryNav } from './model/gallery';
import { deniedMessage } from './model/permissions';

export type CreateBoardStart = 'setup' | 'templates';

function pluralize(noun: string): string {
  if (/(s|x|ch|sh)$/.test(noun)) return `${noun}es`;
  if (/[^aeiou]y$/.test(noun)) return `${noun.slice(0, -1)}ies`;
  return `${noun}s`;
}

export interface CreateBoardWizardProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly workspaceId?: string;
  readonly folderId?: string | null;
  readonly start?: CreateBoardStart;
  /** Preselect a template (deep link / home quick action). */
  readonly templateId?: string;
}

type Stage = 'gallery' | 'setup' | 'solution';

function initialSetup(workspaceId: string | null, folderId: string | null): BoardSetupState {
  return {
    name: 'New board',
    managing: 'items',
    customTerm: '',
    privacy: rememberedPrivacy(workspaceId),
    workspaceId,
    folderId,
    withSampleData: true,
  };
}

export function CreateBoardWizard({
  open,
  onClose,
  workspaceId,
  folderId = null,
  start = 'setup',
  templateId,
}: CreateBoardWizardProps) {
  const router = useRouter();
  const { org } = useOrg();
  const setActiveWorkspace = useShellStore((state) => state.setActiveWorkspace);
  const workspaces = useWorkspaces(org.id);
  const gallery = useTemplateGallery(org.id, open);
  const createBoard = useCreateBoardFromTemplate(org.id);
  const canCreate = useCan('board:create');
  const canWriteWorkspace = useCan('workspace:write');

  const [stage, setStage] = useState<Stage>(start === 'templates' || templateId || !canCreate ? 'gallery' : 'setup');
  const [direction, setDirection] = useState<1 | -1>(1);
  const [selectedId, setSelectedId] = useState<string | null>(templateId ?? null);
  const [chosen, setChosen] = useState<TemplateGalleryEntry | null>(null);
  const [nav, setNav] = useState<GalleryNav>('recommended');
  const [query, setQuery] = useState('');
  const [setup, setSetup] = useState<BoardSetupState>(() => initialSetup(workspaceId ?? null, folderId));
  const [errors, setErrors] = useState<BoardSetupErrors>({});
  const [submitError, setSubmitError] = useState<DescribedError | null>(null);
  const [touched, setTouched] = useState(false);
  /** The user typed a board name: keep it when they go back and pick another template. */
  const [nameTouched, setNameTouched] = useState(false);
  const [installing, setInstalling] = useState(false);
  /** Create was pressed while the workspace list was still loading: submit once it resolves. */
  const [queued, setQueued] = useState(false);

  // Default the workspace once the list arrives.
  const effectiveWorkspaceId = setup.workspaceId ?? workspaces.data?.[0]?.id ?? null;
  const state: BoardSetupState = { ...setup, workspaceId: effectiveWorkspaceId };

  const entries = gallery.data;
  // A shared link to a template that no longer exists: say so and open its likely category.
  // State is adjusted during render (once, when the gallery arrives); the toast is a side effect.
  const [deepLinkChecked, setDeepLinkChecked] = useState(false);
  const missingTemplate = Boolean(templateId && entries && !entries.some((entry) => entry.id === templateId));
  if (!deepLinkChecked && templateId && entries) {
    setDeepLinkChecked(true);
    if (missingTemplate) {
      setSelectedId(null);
      setNav(navForTemplateId(templateId));
    }
  }
  const toastedMissing = useRef(false);
  useEffect(() => {
    if (!missingTemplate || toastedMissing.current) return;
    toastedMissing.current = true;
    toast.info('That template is no longer available', 'Here are similar templates you can start from.');
  }, [missingTemplate]);

  const previewEntry = useMemo(() => {
    if (!entries) return null;
    const id = resolveTemplateId(chosen?.id ?? null, state.managing);
    return entries.find((entry) => entry.id === id) ?? null;
  }, [entries, chosen, state.managing]);

  const go = (next: Stage, dir: 1 | -1) => {
    setDirection(dir);
    setStage(next);
  };

  /** Why "Use template" is unavailable for this entry, or null when it can be used. */
  const blockedReason = (entry: TemplateGalleryEntry): string | null => {
    if (!canCreate) return deniedMessage('board');
    if (entry.type === 'solution' && !canWriteWorkspace) return deniedMessage('solution');
    return null;
  };

  const useTemplate = (entry: TemplateGalleryEntry) => {
    if (blockedReason(entry)) return;
    setSubmitError(null);
    if (entry.type === 'solution') {
      setChosen(entry);
      go('solution', 1);
      return;
    }
    const isBlank = entry.id === 'blank';
    setChosen(isBlank ? null : entry);
    setSetup((current) => ({
      ...current,
      name: nameTouched && current.name.trim() ? current.name : isBlank ? 'New board' : entry.name,
      managing: isBlank ? 'items' : managingForTerminology(entry.itemTerminology),
      customTerm: isBlank ? '' : entry.itemTerminology,
    }));
    setErrors({});
    go('setup', 1);
  };

  const patch = (change: Partial<BoardSetupState>) => {
    setTouched(true);
    if (change.name !== undefined) setNameTouched(true);
    setSubmitError(null);
    setSetup((current) => {
      const next = { ...current, workspaceId: current.workspaceId ?? effectiveWorkspaceId, ...change };
      if (change.workspaceId && change.workspaceId !== current.workspaceId && !touched) {
        return { ...next, privacy: rememberedPrivacy(change.workspaceId) };
      }
      return next;
    });
    if (Object.keys(errors).length) {
      setErrors(validateBoardSetup({ ...state, ...change }));
    }
  };

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (createBoard.isPending) return;
    const validated = validateBoardSetup(state);
    // Never flag the workspace field while it is still a skeleton: queue the submit instead.
    const waiting = !state.workspaceId && workspaces.isLoading;
    const found: BoardSetupErrors = waiting ? { ...validated, workspaceId: undefined } : validated;
    setErrors(found);
    if (waiting && !hasErrors(found)) {
      setQueued(true);
      return;
    }
    setQueued(false);
    if (hasErrors(found) || !state.workspaceId) {
      const field = found.name ? 'board-name-input' : null;
      if (field) document.querySelector<HTMLInputElement>(`[data-testid="${field}"]`)?.focus();
      return;
    }
    const resolved = resolveTemplateId(chosen?.id ?? null, state.managing);
    const terminology = terminologyFor(state);
    const kind = chosen ? undefined : managingOption(state.managing).kind;
    const withSampleData = resolved === 'blank' ? true : state.withSampleData;
    createBoard.mutate(
      {
        workspaceId: state.workspaceId,
        folderId: state.folderId,
        name: state.name.trim(),
        ...(kind ? { kind } : {}),
        privacy: state.privacy,
        itemTerminology: terminology || 'Item',
        templateId: resolved,
        withSampleData,
      },
      {
        onSuccess: (board) => {
          rememberPrivacy(board.workspaceId, state.privacy);
          setActiveWorkspace(org.id, board.workspaceId);
          const noun = (terminology || 'item').toLowerCase();
          toast.success(
            `“${board.name}” is ready`,
            withSampleData && resolved !== 'blank'
              ? `Sample ${pluralize(noun)} included. Delete them any time.`
              : `Add your first ${noun} to get going.`,
          );
          onClose();
          router.push(routes.board(org.slug, board.id));
        },
        onError: (cause) => {
          const described = describeError(cause);
          setSubmitError(described);
        },
      },
    );
  };

  const submitRef = useRef(submit);
  useEffect(() => {
    submitRef.current = submit;
  });
  useEffect(() => {
    if (queued && !workspaces.isLoading) submitRef.current();
  }, [queued, workspaces.isLoading]);

  const dirty = stage === 'setup' ? touched || Boolean(chosen) : stage === 'solution';
  const full = stage === 'gallery';

  return (
    <GuardedDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      dirty={dirty && !createBoard.isPending}
      locked={createBoard.isPending || installing}
    >
      {(requestClose) => (
      <DialogContent
        size={full ? 'xl' : 'lg'}
        data-testid="create-board-wizard"
        aria-describedby={undefined}
        className={cn(
          'overflow-hidden',
          full
            ? 'top-6 right-6 bottom-6 left-6 h-auto max-h-none w-auto translate-x-0 translate-y-0 max-sm:inset-0 max-sm:rounded-none'
            : // Anchored to a fixed top offset: content that loads later grows the dialog downward only.
              'top-[max(24px,7vh)] max-h-[calc(100dvh-max(48px,14vh))] translate-y-0 max-sm:top-4 max-sm:max-h-[calc(100dvh-32px)]',
        )}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={preventEscape}
      >
        <StepTransition stepKey={stage} direction={direction} className="flex min-h-0 flex-1 flex-col">
          {stage === 'gallery' ? (
            <TemplateCenter
              entries={entries}
              loading={gallery.isLoading}
              error={gallery.isError}
              onRetry={() => void gallery.refetch()}
              blockedReason={blockedReason}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onUse={useTemplate}
              nav={nav}
              onNavChange={setNav}
              query={query}
              onQueryChange={setQuery}
            />
          ) : stage === 'solution' && chosen ? (
            <SolutionInstall
              entry={chosen}
              onBack={() => go('gallery', -1)}
              onBusyChange={setInstalling}
              onInstalled={(result) => {
                setActiveWorkspace(org.id, result.workspaceId);
                onClose();
                router.push(routes.workspace(org.slug, result.workspaceId));
              }}
            />
          ) : (
            <form noValidate onSubmit={submit} className="flex min-h-0 flex-1 flex-col" data-testid="board-setup">
              <div className="flex items-start gap-3 px-6 pt-6 pr-14 pb-4">
                {chosen || start === 'templates' || templateId ? (
                  <IconButton
                    label="Back to templates"
                    icon={<ArrowLeft aria-hidden />}
                    onClick={() => go('gallery', -1)}
                    className="-ml-2 shrink-0"
                  />
                ) : null}
                <div className="min-w-0">
                  <DialogPrimitive.Title className="text-xl font-semibold text-fg">
                    {chosen ? `Create from “${chosen.name}”` : 'Create board'}
                  </DialogPrimitive.Title>
                  <DialogPrimitive.Description className="mt-1 text-base text-fg-secondary">
                    {chosen
                      ? 'You can change everything later.'
                      : 'Start blank or from a template.'}
                  </DialogPrimitive.Description>
                </div>
              </div>
              <DialogBody className="pb-4">
                <BoardSetupForm
                  orgId={org.id}
                  state={state}
                  errors={errors}
                  onChange={patch}
                  workspaces={workspaces.data}
                  workspacesLoading={workspaces.isLoading}
                  template={chosen}
                  previewEntry={previewEntry}
                  previewLoading={gallery.isLoading}
                  disabled={createBoard.isPending}
                />
                {submitError ? (
                  <div className="mt-4">
                    <InlineError onRetry={submitError.retryable ? () => submit() : undefined}>{submitError.message}</InlineError>
                  </div>
                ) : null}
              </DialogBody>
              <DialogFooter className="flex-wrap justify-between gap-y-2 max-sm:px-4">
                {chosen ? (
                  <span />
                ) : (
                  <Button
                    variant="tertiary"
                    leadingIcon={<LayoutTemplate aria-hidden />}
                    onClick={() => go('gallery', 1)}
                    data-testid="browse-templates"
                  >
                    Browse templates
                  </Button>
                )}
                <div className="ml-auto flex items-center gap-2">
                  <Button variant="ghost" onClick={requestClose} disabled={createBoard.isPending}>
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    loading={createBoard.isPending || queued}
                    disabled={!canCreate}
                    data-testid="create-board-submit"
                  >
                    Create board
                  </Button>
                </div>
              </DialogFooter>
            </form>
          )}
        </StepTransition>
      </DialogContent>
      )}
    </GuardedDialog>
  );
}
