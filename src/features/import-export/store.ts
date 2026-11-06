'use client';
/**
 * Wizard drafts + import runs. Module-level Zustand stores so an in-progress draft survives
 * navigating away and an import keeps running while the user works elsewhere (progress toast).
 * Drafts and finished-run summaries are mirrored to sessionStorage (per org), so a refresh or
 * browser Back resumes where the user was instead of starting over.
 */
import { create } from 'zustand';
import type { Label } from '@/server/db/schema/cell-values';
import type { ParseFileResult } from '@/server/services/import-export-contracts';
import {
  emptyExistingDestination,
  emptyNewDestination,
  type Destination,
  type ExistingDestination,
  type NewDestination,
} from './lib/destination';
import type { ServerRowFailure } from './lib/error-report';
import type { ColumnMapping, DedupeConfig, RowIssue } from './lib/types';

export const STEP_IDS = ['upload', 'destination', 'map', 'review', 'import'] as const;
export type StepId = (typeof STEP_IDS)[number];

/** Upload a file (CSV / TSV / XLSX) or paste cells. */
export type SourceKind = 'file' | 'paste';

export type { Destination, ExistingDestination, NewDestination };

export interface ImportDraft {
  readonly step: StepId;
  readonly source: SourceKind | null;
  readonly file: ParseFileResult | null;
  readonly sheetIndex: number;
  /** -1 = no header row. */
  readonly headerRow: number;
  readonly destination: Destination;
  /** Last edited draft of each destination type, restored when the user toggles back. */
  readonly savedNew: NewDestination;
  readonly savedExisting: ExistingDestination;
  readonly mappings: readonly ColumnMapping[];
  /** Signature of the inputs `mappings` were built from (re-map when it changes). */
  readonly mappingFor: string | null;
  /** The user changed the mapping by hand (leaving asks for confirmation). */
  readonly mappingEdited: boolean;
  readonly overrides: Readonly<Record<string, string>>;
  readonly excludedRows: readonly number[];
  readonly skipRowsWithIssues: boolean;
  readonly dedupe: DedupeConfig;
  /** The user picked the match key (otherwise it follows the mapping: email → phone → link → name). */
  readonly dedupeKeyChosen: boolean;
  readonly saveMapping: boolean;
  /** Set when the draft was started from a board (ImportDialog). */
  readonly lockedBoardId: string | null;
}

export function emptyDraft(lockedBoardId: string | null = null): ImportDraft {
  const savedNew = emptyNewDestination();
  const savedExisting = emptyExistingDestination(lockedBoardId);
  return {
    step: 'upload',
    source: null,
    file: null,
    sheetIndex: 0,
    headerRow: 0,
    destination: lockedBoardId ? savedExisting : savedNew,
    savedNew,
    savedExisting,
    mappings: [],
    mappingFor: null,
    mappingEdited: false,
    overrides: {},
    excludedRows: [],
    skipRowsWithIssues: false,
    dedupe: { mode: 'create', key: null },
    dedupeKeyChosen: false,
    saveMapping: true,
    lockedBoardId,
  };
}

/** Switch destination type, remembering the draft being left and restoring the other one. */
export function switchDestination(draft: ImportDraft, type: Destination['type']): Partial<ImportDraft> {
  if (draft.destination.type === type) return {};
  const remembered =
    draft.destination.type === 'new' ? { savedNew: draft.destination } : { savedExisting: draft.destination };
  return { ...remembered, destination: type === 'new' ? draft.savedNew : draft.savedExisting };
}

// ---------------------------------------------------------------------------------------------
// Session persistence (best effort: private windows / quota errors fall back to memory only)
// ---------------------------------------------------------------------------------------------

const DRAFT_PREFIX = 'kitstak.import.draft';
const RUNS_PREFIX = 'kitstak.import.runs';
const MAX_STORED_BYTES = 4 * 1024 * 1024;

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function loadStoredDraft(orgId: string, scope: string): ImportDraft | null {
  try {
    const raw = storage()?.getItem(`${DRAFT_PREFIX}:${orgId}:${scope}`);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Omit<Partial<ImportDraft>, 'step' | 'source'> & { step?: string; source?: string | null };
    if (!stored || typeof stored !== 'object') return null;
    // Drafts saved before Source and Upload were merged.
    const step = stored.step === 'source' ? 'upload' : stored.step;
    if (!STEP_IDS.includes(step as StepId)) return null;
    const source: SourceKind | null = stored.source === 'paste' ? 'paste' : stored.source ? 'file' : null;
    return { ...emptyDraft(stored.lockedBoardId ?? null), ...stored, step: step as StepId, source };
  } catch {
    return null;
  }
}

export function storeDraft(orgId: string, scope: string, draft: ImportDraft | null): void {
  const target = storage();
  if (!target) return;
  const key = `${DRAFT_PREFIX}:${orgId}:${scope}`;
  try {
    if (!draft || (!draft.source && !draft.file)) {
      target.removeItem(key);
      return;
    }
    let raw = JSON.stringify(draft);
    // Very large files: keep the choices, drop the rows (the user re-uploads after a refresh).
    if (raw.length > MAX_STORED_BYTES) raw = JSON.stringify({ ...draft, file: null, mappingFor: null, step: 'upload' });
    target.setItem(key, raw);
  } catch {
    // Quota or privacy mode: the in-memory draft still works for this tab.
  }
}

interface DraftStore {
  readonly drafts: Readonly<Record<string, ImportDraft>>;
  update(scope: string, patch: Partial<ImportDraft> | ((draft: ImportDraft) => Partial<ImportDraft>)): void;
  reset(scope: string, lockedBoardId?: string | null): void;
  hydrate(scope: string, draft: ImportDraft): void;
}

/** Drafts are keyed by scope: `page` for /import, `board:<id>` for the board dialog. */
export const useDraftStore = create<DraftStore>((set) => ({
  drafts: {},
  update: (scope, patch) =>
    set((state) => {
      const current = state.drafts[scope] ?? emptyDraft(scope.startsWith('board:') ? scope.slice(6) : null);
      const next = typeof patch === 'function' ? patch(current) : patch;
      return { drafts: { ...state.drafts, [scope]: { ...current, ...next } } };
    }),
  reset: (scope, lockedBoardId = null) =>
    set((state) => ({ drafts: { ...state.drafts, [scope]: emptyDraft(lockedBoardId) } })),
  hydrate: (scope, draft) => set((state) => ({ drafts: { ...state.drafts, [scope]: draft } })),
}));

export type RunStatus = 'preparing' | 'running' | 'done' | 'failed' | 'cancelled' | 'undoing' | 'undone';

export interface UndoSummary {
  readonly archived: number;
  readonly reverted: number;
  readonly removedColumns: number;
  readonly removedLabels: number;
  readonly boardDeleted: boolean;
}

export interface ImportRun {
  readonly batchId: string;
  readonly scope: string;
  readonly orgId: string;
  readonly orgSlug: string;
  readonly boardId: string | null;
  readonly boardName: string;
  readonly boardCreated: boolean;
  /** New columns + new labels the import added to an existing board. */
  readonly schemaAdded: number;
  readonly fileName: string;
  readonly terminology: string;
  readonly status: RunStatus;
  readonly total: number;
  readonly processed: number;
  readonly created: number;
  readonly updated: number;
  readonly skipped: number;
  readonly linkedCreated: number;
  readonly failures: readonly ServerRowFailure[];
  readonly clientIssues: readonly RowIssue[];
  readonly clientSkipped: number;
  /** Friendly message shown on the summary. */
  readonly error: string | null;
  /** Server detail behind `error` (goes into the error report). */
  readonly errorDetail: string | null;
  /** Rows can be resumed from `processed` (the runner still holds them in this tab). */
  readonly resumable: boolean;
  readonly undo: UndoSummary | null;
  readonly startedAt: number;
  readonly finishedAt: number | null;
  readonly cancelRequested: boolean;
  /** Set while a failed request is being retried (connection lost / server busy). */
  readonly reconnect?: { readonly attempt: number; readonly of: number; readonly retryAt: number } | null;
  /** Paused because the browser went offline; resumes by itself when it is back online. */
  readonly pausedOffline?: boolean;
  /** Columns and labels the import adds (shown under "What was added" on the summary). */
  readonly added?: AddedSchema;
}

export interface AddedSchema {
  readonly columns: readonly { readonly title: string; readonly type: string }[];
  readonly labels: readonly { readonly column: string; readonly label: Label }[];
}

interface RunStore {
  readonly runs: Readonly<Record<string, ImportRun>>;
  /** Latest run per scope. */
  readonly byScope: Readonly<Record<string, string>>;
  /** Runs the user just closed ("Import another"), so a lagging `?run=` URL doesn't reopen them. */
  readonly dismissedAt: Readonly<Record<string, number>>;
  put(run: ImportRun): void;
  patch(batchId: string, patch: Partial<ImportRun>): void;
  clearScope(scope: string): void;
  /** Show `batchId` as the scope's run (deep link / restored summary). */
  attach(scope: string, run: ImportRun): void;
}

function persistRuns(runs: Readonly<Record<string, ImportRun>>): void {
  const target = storage();
  if (!target) return;
  const byOrg = new Map<string, ImportRun[]>();
  for (const run of Object.values(runs)) {
    if (run.status === 'preparing' || run.status === 'running' || run.status === 'undoing') continue;
    byOrg.set(run.orgId, [
      ...(byOrg.get(run.orgId) ?? []),
      { ...run, clientIssues: run.clientIssues.slice(0, 500), resumable: false, reconnect: null, pausedOffline: false },
    ]);
  }
  try {
    for (const [orgId, list] of byOrg) {
      const recent = [...list].sort((a, b) => b.startedAt - a.startedAt).slice(0, 10);
      target.setItem(`${RUNS_PREFIX}:${orgId}`, JSON.stringify(recent));
    }
  } catch {
    // best effort
  }
}

export function loadStoredRun(orgId: string, batchId: string): ImportRun | null {
  try {
    const raw = storage()?.getItem(`${RUNS_PREFIX}:${orgId}`);
    const list = raw ? (JSON.parse(raw) as ImportRun[]) : [];
    return Array.isArray(list) ? (list.find((run) => run.batchId === batchId) ?? null) : null;
  } catch {
    return null;
  }
}

export const useRunStore = create<RunStore>((set, get) => ({
  runs: {},
  byScope: {},
  dismissedAt: {},
  put: (run) =>
    set((state) => ({
      runs: { ...state.runs, [run.batchId]: run },
      byScope: { ...state.byScope, [run.scope]: run.batchId },
    })),
  patch: (batchId, patch) => {
    set((state) => {
      const current = state.runs[batchId];
      if (!current) return state;
      return { runs: { ...state.runs, [batchId]: { ...current, ...patch } } };
    });
    persistRuns(get().runs);
  },
  clearScope: (scope) =>
    set((state) => {
      const rest = { ...state.byScope };
      const cleared = rest[scope];
      delete rest[scope];
      return { byScope: rest, dismissedAt: cleared ? { ...state.dismissedAt, [cleared]: Date.now() } : state.dismissedAt };
    }),
  attach: (scope, run) =>
    set((state) => ({
      runs: { ...state.runs, [run.batchId]: state.runs[run.batchId] ?? { ...run, scope } },
      byScope: { ...state.byScope, [scope]: run.batchId },
    })),
}));

export function useScopeRun(scope: string): ImportRun | null {
  return useRunStore((state) => {
    const id = state.byScope[scope];
    return id ? (state.runs[id] ?? null) : null;
  });
}

const DISMISS_GRACE_MS = 5_000;

/** True while a just-dismissed run's id may still linger in the URL. */
export function isRecentlyDismissed(state: { readonly dismissedAt: Readonly<Record<string, number>> }, batchId: string): boolean {
  const at = state.dismissedAt[batchId];
  return at !== undefined && Date.now() - at < DISMISS_GRACE_MS;
}
