'use client';
import './import-wizard.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Skeleton, cn } from '@/components/ui';
import { useBoards, useOrgId } from '@/lib/hooks';
import { useOrg } from '@/features/shell/org-context';
import { setBackgrounded, startImport } from '../runner';
import { destinationError, withFileDefaults } from '../lib/destination';
import { baseFileName } from '../lib/error-report';
import { buildHeaders } from '../lib/infer';
import {
  STEP_IDS,
  emptyDraft,
  loadStoredDraft,
  storeDraft,
  switchDestination,
  useDraftStore,
  useRunStore,
  useScopeRun,
  isRecentlyDismissed,
  type Destination,
  type ImportDraft,
  type StepId,
} from '../store';
import { pluralize, useImportModel, type ImportModel } from '../use-import-model';
import type { ParseFileResult } from '@/server/services/import-export-contracts';
import type { ColumnMapping } from '../lib/types';
import { KeepProgressDialog } from './keep-progress-dialog';
import { RunLoader } from './run-loader';
import { StepDestination } from './step-destination';
import { StepImport } from './step-import';
import { StepMap } from './step-map';
import { StepReview } from './step-review';
import { StepUpload } from './step-upload';
import { RAIL_STEPS, WizardRail } from './wizard-rail';

export interface ImportWizardProps {
  /** Draft scope: `page` for /import, `board:<id>` for a board dialog. */
  readonly scope: string;
  readonly variant: 'page' | 'dialog';
  readonly lockedBoardId?: string | null;
  /** Called when the user leaves (Cancel / Done). `keep` = draft kept for later. */
  readonly onExit?: (keep: boolean) => void;
}

const LAST_EDITABLE = 3;
const IMPORT_STEP = 4;

function stepIndex(step: StepId): number {
  return STEP_IDS.indexOf(step);
}

/**
 * Still loading data that validation from the destination step onward depends on (don't
 * validate or clamp yet). Source and upload never wait on it.
 */
function isSettling(model: ImportModel): boolean {
  if (!model.draft.file || stepIndex(model.draft.step) < 1) return false;
  return model.boardLoading || model.membersLoading || model.workspacesLoading;
}

/** Highest step the draft is valid up to (inclusive). */
function reachableIndex(model: ImportModel): number {
  if (!model.draft.file) return 0;
  if (destinationError(model.destination) || model.boardError) return 1;
  if (model.mappingProblems.length || model.draft.mappings.length === 0) return 2;
  return LAST_EDITABLE;
}

export function ImportWizard(props: ImportWizardProps) {
  const orgId = useOrgId();
  const searchParams = useSearchParams();
  const draft = useDraftStore((state) => state.drafts[props.scope]);
  const hydrate = useDraftStore((state) => state.hydrate);
  const runParam = props.variant === 'page' ? searchParams.get('run') : null;
  const attachedRun = useRunStore((state) => state.byScope[props.scope]);
  const dismissed = useRunStore((state) => Boolean(runParam) && isRecentlyDismissed(state, runParam as string));
  useEffect(() => {
    if (draft) return;
    hydrate(props.scope, loadStoredDraft(orgId, props.scope) ?? emptyDraft(props.lockedBoardId ?? null));
  }, [draft, hydrate, orgId, props.scope, props.lockedBoardId]);

  if (runParam && attachedRun !== runParam && !dismissed) return <RunLoader scope={props.scope} batchId={runParam} />;
  if (!draft) {
    return (
      <div className="flex flex-col gap-4 p-6" data-skeleton>
        <Skeleton height={28} width={280} />
        <Skeleton height={140} rounded="lg" />
      </div>
    );
  }
  return <WizardBody {...props} />;
}

function WizardBody({ scope, variant, onExit }: ImportWizardProps) {
  const orgId = useOrgId();
  const { org } = useOrg();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const model = useImportModel(scope);
  // Warm the board list for the destination step while the user is still uploading.
  useBoards({ state: 'active' });
  const update = useDraftStore((state) => state.update);
  const reset = useDraftStore((state) => state.reset);
  const clearScope = useRunStore((state) => state.clearScope);
  const run = useScopeRun(scope);
  const { draft } = model;
  const [showErrors, setShowErrors] = useState(false);
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [starting, setStarting] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const focusOnStep = useRef(false);

  const patch = useCallback((value: Partial<ImportDraft>) => update(scope, value), [update, scope]);
  const settling = isSettling(model);
  const reachable = settling ? Math.max(stepIndex(draft.step), 0) : reachableIndex(model);
  const current = run ? IMPORT_STEP : Math.min(stepIndex(draft.step), reachable);
  const announcement = `Step ${current + 1} of ${RAIL_STEPS.length}, ${RAIL_STEPS[current]?.title ?? ''}`;
  // Slide direction + error reset follow the visible step (adjusted during render, not in an effect).
  const [shownStep, setShownStep] = useState(current);
  if (shownStep !== current) {
    setShownStep(current);
    setDirection(current < shownStep ? 'back' : 'forward');
    setShowErrors(false);
  }

  // Mirror the draft to sessionStorage (refresh / Back resume where the user was).
  useEffect(() => {
    const handle = window.setTimeout(() => storeDraft(orgId, scope, draft), 250);
    return () => window.clearTimeout(handle);
  }, [orgId, scope, draft]);

  // Hand-edited mappings: ask before the tab closes.
  const guardUnload = Boolean(draft.file && draft.mappingEdited && !run);
  useEffect(() => {
    if (!guardUnload) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [guardUnload]);

  // URL ↔ step (page only). Each step is a history entry, so browser Back goes to the previous step.
  const urlStep = variant === 'page' ? searchParams.get('step') : null;
  const urlRun = variant === 'page' ? searchParams.get('run') : null;
  const urlIndex = urlStep ? STEP_IDS.indexOf(urlStep as StepId) : -1;
  const urlPending = !run && urlIndex >= 0 && urlIndex <= Math.min(reachable, LAST_EDITABLE) && urlIndex !== current;
  useEffect(() => {
    if (variant !== 'page' || settling || !urlPending) return;
    focusOnStep.current = true;
    patch({ step: STEP_IDS[urlIndex] as StepId });
  }, [variant, settling, urlPending, urlIndex, patch]);
  useEffect(() => {
    if (variant !== 'page' || settling || urlPending) return;
    if (run) {
      if (urlRun !== run.batchId) router.replace(`?run=${run.batchId}`, { scroll: false });
      return;
    }
    const id = STEP_IDS[current] ?? 'upload';
    if (urlStep !== id || urlRun) router.replace(`?step=${id}`, { scroll: false });
  }, [variant, settling, urlPending, run, urlRun, urlStep, current, router]);

  // While the wizard is visible, the in-page progress replaces the toast.
  const runId = run?.batchId;
  useEffect(() => {
    if (!runId) return;
    setBackgrounded(runId, false);
    return () => setBackgrounded(runId, true);
  }, [runId]);

  // Move focus to the new step's heading and announce it.
  useEffect(() => {
    if (!focusOnStep.current) return;
    focusOnStep.current = false;
    const frame = requestAnimationFrame(() => {
      const heading = content.current?.querySelector<HTMLElement>('h2');
      if (!heading) return;
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [current]);

  const goTo = (index: number) => {
    const id = STEP_IDS[index] ?? 'upload';
    focusOnStep.current = true;
    if (variant === 'page') router.push(`?step=${id}`, { scroll: false });
    patch({ step: id });
    content.current?.scrollTo({ top: 0 });
  };

  const focusFirstError = () =>
    requestAnimationFrame(() => {
      const root = content.current;
      const target =
        root?.querySelector<HTMLElement>('[data-error-focus]') ??
        root?.querySelector<HTMLElement>('[aria-invalid="true"]') ??
        root?.querySelector<HTMLElement>('[role="alert"]');
      target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      if (target) {
        if (target.tabIndex < 0 && !target.matches('button, input, select, textarea, a[href]')) target.tabIndex = -1;
        target.focus({ preventScroll: true });
      }
    });

  const begin = async () => {
    if (starting) return;
    setStarting(true);
    try {
      const batchId = await startImport({
        scope,
        orgId,
        orgSlug: org.slug,
        draft: { ...draft, destination: model.destination, dedupe: model.dedupe },
        plan: model.plan,
        rows: model.built.rows,
        clientIssues: model.built.issues,
        clientSkipped: model.built.skippedRows.length,
        headers: model.headers,
        terminology: model.terminology,
        boardName: model.destination.type === 'new' ? model.destination.name.trim() : (model.boardName ?? 'Board'),
        queryClient,
        navigate: (href) => router.push(href),
      });
      if (variant === 'page') router.replace(`?run=${batchId}`, { scroll: false });
      focusOnStep.current = true;
    } finally {
      setStarting(false);
    }
  };

  const next = () => {
    if (settling) return;
    if (current >= LAST_EDITABLE) {
      void begin();
      return;
    }
    if (reachable <= current) {
      setShowErrors(true);
      focusFirstError();
      return;
    }
    goTo(current + 1);
  };

  const leave = (keep: boolean) => {
    setConfirmLeave(false);
    if (!keep) {
      reset(scope, draft.lockedBoardId);
      clearScope(scope);
      storeDraft(orgId, scope, null);
    }
    if (onExit) onExit(keep);
    else router.push(`/${org.slug}`);
  };

  const another = () => {
    clearScope(scope);
    reset(scope, draft.lockedBoardId);
    focusOnStep.current = true;
    if (variant === 'page') router.push('?step=upload', { scroll: false });
  };

  const onParsed = (file: ParseFileResult, headerRow: number) => {
    const headers = buildHeaders(file.sheets[0]?.rows.slice(0, Math.max(headerRow, 0) + 1) ?? [], headerRow);
    const savedNew = withFileDefaults(draft.savedNew, baseFileName(file.fileName), headers);
    const destination = draft.destination.type === 'new' ? withFileDefaults(draft.destination, baseFileName(file.fileName), headers) : draft.destination;
    patch({ file, sheetIndex: 0, headerRow, mappingFor: null, mappingEdited: false, savedNew, destination });
    setShowErrors(false);
  };

  const onMappings = useCallback((mappings: ColumnMapping[]) => patch({ mappings, mappingEdited: true }), [patch]);
  const onDestination = useCallback(
    (destination: Destination) =>
      patch(destination.type === 'new' ? { destination, savedNew: destination } : { destination, savedExisting: destination }),
    [patch],
  );
  const onDestinationType = useCallback(
    (type: Destination['type']) => {
      // Errors only show after Next in the mode the user is in now.
      setShowErrors(false);
      update(scope, (state) => switchDestination(state, type));
    },
    [update, scope],
  );

  const rowsToImport = model.built.rows.length;
  const { match } = model;
  const finalCounts = match.enabled && !match.pending
    ? { create: match.create, update: model.dedupe.mode === 'update' ? match.matched : 0 }
    : { create: rowsToImport, update: 0 };
  const nextLabel = settling
    ? 'Loading…'
    : current === LAST_EDITABLE
      ? match.pending
        ? 'Checking duplicates…'
        : importLabel(finalCounts.create, finalCounts.update, model.terminology)
      : 'Next';
  const nextDisabled =
    settling || (current === LAST_EDITABLE && (rowsToImport === 0 || starting || match.pending || finalCounts.create + finalCounts.update === 0));
  const hasProgress = Boolean(draft.file);

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col md:flex-row', variant === 'page' && 'min-h-[620px]')}>
      <WizardRail
        current={current}
        reachable={Math.min(reachable, LAST_EDITABLE)}
        locked={Boolean(run)}
        complete={run?.status === 'done' || run?.status === 'undone'}
        onSelect={goTo}
      />
      <p className="sr-only" aria-live="polite" data-testid="import-step-announcer">
        {announcement}
      </p>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div ref={content} className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
          <div
            key={current}
            data-direction={direction}
            className={cn('ie-step-enter w-full', current >= 2 ? 'max-w-[1040px]' : 'max-w-[880px]')}
            data-testid={`import-panel-${STEP_IDS[current]}`}
          >
            {run ? (
              <StepImport run={run} onAnother={another} onBackground={() => (onExit ? onExit(true) : router.push(`/${org.slug}`))} />
            ) : current === 0 ? (
              <StepUpload
                source={draft.source}
                file={draft.file}
                sheetIndex={draft.sheetIndex}
                headerRow={draft.headerRow}
                showErrors={showErrors}
                onParsed={onParsed}
                onSheet={(sheetIndex, headerRow) => patch({ sheetIndex, headerRow, mappingFor: null })}
                onHeaderRow={(headerRow) => patch({ headerRow, mappingFor: null })}
                onClear={() => patch({ file: null, mappingFor: null, mappings: [], mappingEdited: false })}
                onSource={(source) => {
                  setShowErrors(false);
                  patch({ source });
                }}
              />
            ) : current === 1 ? (
              <StepDestination
                destination={model.destination}
                locked={Boolean(draft.lockedBoardId)}
                groups={model.groups}
                boardLoading={model.boardLoading}
                boardName={model.boardName}
                showErrors={showErrors}
                onChange={onDestination}
                onTypeChange={onDestinationType}
              />
            ) : current === 2 ? (
              settling || draft.mappingFor === null ? (
                <div className="flex flex-col gap-3" data-skeleton>
                  <Skeleton height={28} width={240} />
                  {Array.from({ length: 5 }, (_, index) => (
                    <Skeleton key={index} height={64} rounded="md" />
                  ))}
                </div>
              ) : (
                <StepMap model={model} showErrors={showErrors} onChange={onMappings} />
              )
            ) : (
              <StepReview model={model} onDraft={patch} />
            )}
          </div>
        </div>
        {run ? null : (
          <div className="border-t border-border-subtle bg-panel px-4 py-3 sm:px-8">
            <div className={cn('flex w-full items-center justify-between gap-2', current >= 2 ? 'max-w-[1040px]' : 'max-w-[880px]')}>
              <div>
                {current > 0 ? (
                  <Button variant="ghost" onClick={() => goTo(current - 1)} data-testid="import-back">
                    Back
                  </Button>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  ref={cancelButton}
                  variant="ghost"
                  onClick={() => (hasProgress ? setConfirmLeave(true) : leave(false))}
                  data-testid="import-cancel"
                >
                  Cancel
                </Button>
                <Button onClick={next} disabled={nextDisabled} loading={starting} data-testid="import-next">
                  {nextLabel}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
      <KeepProgressDialog
        open={confirmLeave}
        onOpenChange={setConfirmLeave}
        onKeep={() => leave(true)}
        onDiscard={() => leave(false)}
        returnFocus={cancelButton}
      />
    </div>
  );
}

/** "Import 5 contacts" · "Update 5 contacts" · "Import 3, update 2 contacts". */
export function importLabel(create: number, updates: number, terminology: string): string {
  const format = (value: number) => value.toLocaleString('en-US');
  if (updates > 0 && create === 0) return `Update ${format(updates)} ${pluralize(terminology, updates)}`;
  if (updates > 0) return `Import ${format(create)}, update ${format(updates)} ${pluralize(terminology, create + updates)}`;
  return `Import ${format(create)} ${pluralize(terminology, create)}`;
}

export type { ImportDraft };
