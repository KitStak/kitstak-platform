'use client';
/**
 * Background import runner: prepare → batches → complete. Lives outside React so it keeps
 * running while the user navigates; progress is mirrored into `useRunStore` and, once the
 * wizard is closed, into a progress toast. The remaining rows stay in memory so a run that hits
 * a transient failure can resume from the last completed batch (same batch id, so Undo still
 * covers everything).
 */
import type { QueryClient } from '@tanstack/react-query';
import { toast as sonner } from 'sonner';
import { ApiClientError } from '@/lib/api';
import { errorMessage } from '@/lib/hooks';
import { queryKeys } from '@/lib/query-keys';
import type { PrepareImportInput, PrepareImportResult } from '@/server/services/import-export-contracts';
import { importApi } from './api';
import type { ColumnPlan } from './lib/plan';
import { IMPORT_LIMITS, type DedupeConfig, type ImportRowPayload, type RowIssue } from './lib/types';
import type { Label } from '@/server/db/schema/cell-values';
import { useRunStore, type AddedSchema, type ImportDraft, type ImportRun } from './store';
import { pluralize } from './use-import-model';

export interface StartImportArgs {
  readonly scope: string;
  readonly orgId: string;
  readonly orgSlug: string;
  readonly draft: ImportDraft;
  readonly plan: ColumnPlan;
  readonly rows: readonly ImportRowPayload[];
  readonly clientIssues: readonly RowIssue[];
  readonly clientSkipped: number;
  readonly headers: readonly string[];
  readonly terminology: string;
  readonly boardName: string;
  readonly queryClient: QueryClient;
  /** Client-side navigation (toast actions). */
  readonly navigate: (href: string) => void;
}

interface Job {
  readonly args: StartImportArgs;
  readonly fileName: string;
  prepared: PrepareImportResult | null;
  rows: readonly ImportRowPayload[];
  readonly dedupe: DedupeConfig;
}

/** In-memory jobs (rows are never persisted). */
const jobs = new Map<string, Job>();
const backgrounded = new Set<string>();

const RETRY_DELAYS_MS = [1_000, 3_000, 6_000] as const;
/** Longest the runner keeps retrying before it shows the paused state. */
const MAX_RETRY_WAIT_MS = 15_000;

/** Thrown when a run is interrupted on purpose (offline, or "Pause now" while reconnecting). */
export class RunInterrupted extends Error {
  constructor(readonly reason: 'offline' | 'paused') {
    super(reason === 'offline' ? "You're offline" : 'Paused');
    this.name = 'RunInterrupted';
  }
}

/** One controller per executing run: aborting it stops the retry wait at once. */
const controllers = new Map<string, AbortController>();
let watchingConnectivity = false;

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/** Pause every run the moment the browser goes offline; resume the paused ones when it's back. */
function watchConnectivity(): void {
  if (watchingConnectivity || typeof window === 'undefined') return;
  watchingConnectivity = true;
  window.addEventListener('offline', () => {
    for (const controller of controllers.values()) controller.abort(new RunInterrupted('offline'));
  });
  window.addEventListener('online', () => {
    for (const run of Object.values(useRunStore.getState().runs)) {
      if (run.pausedOffline && run.status === 'failed' && jobs.has(run.batchId)) resumeRun(run.batchId);
    }
  });
}

export function importRunHref(orgSlug: string, batchId: string): string {
  return `/${orgSlug}/import?run=${batchId}`;
}

export function setBackgrounded(batchId: string, value: boolean): void {
  if (value) backgrounded.add(batchId);
  else backgrounded.delete(batchId);
  const run = useRunStore.getState().runs[batchId];
  if (value && run && (run.status === 'running' || run.status === 'preparing')) progressToast(run);
}

function newBatchId(): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return `imp${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function progressToast(run: ImportRun): void {
  const percent = run.total ? Math.round((run.processed / run.total) * 100) : 0;
  sonner.loading(`Importing ${run.fileName}…`, {
    id: run.batchId,
    description:
      run.status === 'preparing'
        ? 'Setting up the board…'
        : `${run.processed.toLocaleString('en-US')} of ${run.total.toLocaleString('en-US')} rows (${percent}%)`,
    duration: Number.POSITIVE_INFINITY,
  });
}

function remap(row: ImportRowPayload, keyByRef: Readonly<Record<string, string>>): ImportRowPayload {
  const values = Object.fromEntries(Object.entries(row.values).map(([key, value]) => [keyByRef[key] ?? key, value]));
  const links = row.links
    ? Object.fromEntries(Object.entries(row.links).map(([key, value]) => [keyByRef[key] ?? key, value]))
    : undefined;
  return { ...row, values, ...(links ? { links } : {}) };
}

export function buildPrepare(args: StartImportArgs, batchId: string): PrepareImportInput {
  const { draft, plan } = args;
  const newColumns = plan.columns
    .filter((entry) => entry.isNew)
    .map((entry) => ({
      ref: entry.column.key,
      title: entry.column.title,
      type: entry.column.type as PrepareImportInput['newColumns'][number]['type'],
      settings: entry.column.settings,
    }));
  const labelUpdates = plan.columns
    .filter((entry) => entry.labelUpdate)
    .map((entry) => ({ columnKey: entry.labelUpdate?.columnKey as string, settings: { labels: entry.labelUpdate?.labels } }));
  const nameHeader = plan.nameIndex !== null ? args.headers[plan.nameIndex] : undefined;
  const destination = draft.destination;
  if (destination.type === 'new') {
    return {
      batchId,
      destination: {
        type: 'new',
        workspaceId: destination.workspaceId as string,
        name: destination.name.trim(),
        kind: destination.kind,
        privacy: 'main',
        ...(nameHeader ? { nameColumnTitle: nameHeader.slice(0, 255) } : {}),
        groupTitle: `Imported ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
      },
      newColumns,
      labelUpdates: [],
    };
  }
  const savedMapping = draft.saveMapping
    ? Object.fromEntries(
        draft.mappings
          .filter((mapping) => mapping.target.kind === 'existing')
          .map((mapping) => [
            (args.headers[mapping.sourceIndex] ?? '').toLowerCase().slice(0, 200),
            (mapping.target as { columnKey: string }).columnKey,
          ]),
      )
    : undefined;
  return {
    batchId,
    destination: {
      type: 'existing',
      boardId: destination.boardId as string,
      ...(destination.groupId === '__new__'
        ? { newGroupTitle: destination.newGroupTitle.trim() || 'Imported' }
        : destination.groupId
          ? { groupId: destination.groupId }
          : {}),
    },
    newColumns,
    labelUpdates,
    ...(savedMapping && Object.keys(savedMapping).length ? { savedMapping } : {}),
  };
}

function finishToast(run: ImportRun, navigate: (href: string) => void): void {
  const term = pluralize(run.terminology, run.created);
  const parts = [
    `${run.created.toLocaleString('en-US')} ${term} added`,
    run.updated ? `${run.updated.toLocaleString('en-US')} updated` : null,
    run.skipped + run.clientSkipped ? `${(run.skipped + run.clientSkipped).toLocaleString('en-US')} skipped` : null,
    run.failures.length ? `${run.failures.length.toLocaleString('en-US')} failed` : null,
  ].filter(Boolean);
  sonner.success(`Import finished: ${run.boardName}`, {
    id: run.batchId,
    description: parts.join(' · '),
    duration: 12_000,
    action: { label: 'View summary', onClick: () => navigate(importRunHref(run.orgSlug, run.batchId)) },
  });
}

/** Statuses worth retrying: network blips, 5xx, rate limits. */
function isTransient(error: unknown): boolean {
  if (!(error instanceof ApiClientError)) return false;
  return error.code === 'NETWORK_ERROR' || error.code === 'RATE_LIMITED' || error.status === 429 || error.status >= 500;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(signal?.reason);
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export interface RetryInfo {
  /** The attempt about to be made (2 = first retry). */
  readonly attempt: number;
  readonly of: number;
  readonly delayMs: number;
}

export interface RetryOptions {
  readonly delays?: readonly number[];
  /** Total time spent waiting between attempts before giving up. */
  readonly maxWaitMs?: number;
  readonly onRetry?: (info: RetryInfo) => void;
  /** Aborting stops at once with the signal's reason (offline / paused). */
  readonly signal?: AbortSignal;
}

function isDelayList(options: RetryOptions | readonly number[]): options is readonly number[] {
  return Array.isArray(options);
}

/**
 * Retries transient failures with exponential backoff + jitter (longer for rate limits), telling
 * the caller before each wait so the UI can show "reconnecting". Gives up after `maxWaitMs`, or
 * at once when the browser is offline. Safe because prepare and batches are idempotent per batch
 * id on the server (a retry after a lost reply replays the stored result).
 */
export async function sendWithRetry<T>(send: () => Promise<T>, options: RetryOptions | readonly number[] = {}): Promise<T> {
  const { delays = RETRY_DELAYS_MS, maxWaitMs = MAX_RETRY_WAIT_MS, onRetry, signal } = isDelayList(options) ? { delays: options } : options;
  let waited = 0;
  for (let attempt = 0; ; attempt += 1) {
    if (signal?.aborted) throw signal.reason;
    try {
      return await send();
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      const base = delays[attempt];
      if (base === undefined || !isTransient(error)) throw error;
      if (isOffline()) throw new RunInterrupted('offline');
      const limited = error instanceof ApiClientError && (error.code === 'RATE_LIMITED' || error.status === 429);
      const wanted = (limited ? base * 2 : base) + Math.round(Math.random() * 400);
      const delay = Math.min(wanted, maxWaitMs - waited);
      if (delay <= 0 && wanted > 0) throw error;
      waited += delay;
      onRetry?.({ attempt: attempt + 2, of: delays.length + 1, delayMs: delay });
      await wait(delay, signal);
    }
  }
}

/** Friendly summary text for a failed run; the raw detail goes into the error report. */
export function friendlyFailure(error: unknown, processed: number, prepared: boolean): string {
  const rows = `${processed.toLocaleString('en-US')} ${processed === 1 ? 'row' : 'rows'}`;
  if (error instanceof RunInterrupted && error.reason === 'offline') {
    return prepared
      ? `You're offline. The import paused after ${rows} and continues by itself when you're back online.`
      : "You're offline. The import starts by itself when you're back online.";
  }
  if (isTransient(error)) {
    return prepared
      ? `We lost the connection to the server after ${rows}. Resume to continue where it stopped.`
      : "We couldn't reach the server to set up the import. Try again in a moment.";
  }
  return prepared
    ? `The import stopped after ${rows}: ${errorMessage(error, 'something went wrong')}`
    : errorMessage(error, "We couldn't set up the import.");
}

const MAX_LISTED_LABELS = 40;

/** New columns + labels the plan adds, for the summary's "What was added" list. */
export function addedSchema(plan: ColumnPlan): AddedSchema {
  const labelsOf = (settings: unknown): Label[] => ((settings as { labels?: Label[] } | null | undefined)?.labels ?? []).filter(Boolean);
  const columns = plan.columns.filter((entry) => entry.isNew).map((entry) => ({ title: entry.column.title, type: entry.column.type }));
  const labels = plan.columns.flatMap((entry) => {
    if (entry.isNew) return labelsOf(entry.column.settings).map((label) => ({ column: entry.column.title, label }));
    if (!entry.labelUpdate) return [];
    const before = new Set(labelsOf(entry.column.settings).map((label) => label.id));
    return entry.labelUpdate.labels.filter((label) => !before.has(label.id)).map((label) => ({ column: entry.column.title, label }));
  });
  return { columns, labels: labels.slice(0, MAX_LISTED_LABELS) };
}

export async function startImport(args: StartImportArgs): Promise<string> {
  watchConnectivity();
  const batchId = newBatchId();
  const fileName = args.draft.file?.fileName ?? 'Pasted data';
  useRunStore.getState().put({
    batchId,
    scope: args.scope,
    orgId: args.orgId,
    orgSlug: args.orgSlug,
    boardId: args.draft.destination.type === 'existing' ? args.draft.destination.boardId : null,
    boardName: args.boardName,
    boardCreated: args.draft.destination.type === 'new',
    schemaAdded: 0,
    fileName,
    terminology: args.terminology,
    status: 'preparing',
    total: args.rows.length,
    processed: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    linkedCreated: 0,
    failures: [],
    clientIssues: args.clientIssues,
    clientSkipped: args.clientSkipped,
    error: null,
    errorDetail: null,
    resumable: false,
    undo: null,
    startedAt: Date.now(),
    finishedAt: null,
    cancelRequested: false,
    added: addedSchema(args.plan),
  });
  jobs.set(batchId, {
    args,
    fileName,
    prepared: null,
    rows: args.rows,
    dedupe: args.draft.destination.type === 'existing' ? args.draft.dedupe : { mode: 'create', key: null },
  });
  void execute(batchId);
  return batchId;
}

/** Continue a failed / stopped run from the last completed batch. */
export function resumeRun(batchId: string): void {
  const run = useRunStore.getState().runs[batchId];
  if (!run || !jobs.has(batchId) || !run.resumable) return;
  patchRun(batchId, {
    status: run.boardId && jobs.get(batchId)?.prepared ? 'running' : 'preparing',
    error: null,
    errorDetail: null,
    resumable: false,
    cancelRequested: false,
    finishedAt: null,
    reconnect: null,
    pausedOffline: false,
  });
  void execute(batchId);
}

function patchRun(batchId: string, value: Partial<ImportRun>): void {
  useRunStore.getState().patch(batchId, value);
  const run = useRunStore.getState().runs[batchId];
  if (run && backgrounded.has(batchId) && (run.status === 'running' || run.status === 'preparing')) progressToast(run);
}

async function execute(batchId: string): Promise<void> {
  const job = jobs.get(batchId) as Job;
  const { args } = job;
  const api = importApi(args.orgId);
  const current = () => useRunStore.getState().runs[batchId] as ImportRun;
  const controller = new AbortController();
  controllers.set(batchId, controller);
  if (isOffline()) controller.abort(new RunInterrupted('offline'));
  const retry: RetryOptions = {
    signal: controller.signal,
    onRetry: (info) => patchRun(batchId, { reconnect: { attempt: info.attempt, of: info.of, retryAt: Date.now() + info.delayMs } }),
  };
  async function send<T>(call: () => Promise<T>): Promise<T> {
    const result = await sendWithRetry(call, retry);
    if (current().reconnect) patchRun(batchId, { reconnect: null });
    return result;
  }
  try {
    if (!job.prepared) {
      const prepared = await send(() => api.prepare(buildPrepare(args, batchId)));
      job.prepared = prepared;
      job.rows = args.rows.map((row) => remap(row, prepared.keyByRef));
      patchRun(batchId, {
        boardId: prepared.board.id,
        boardName: prepared.board.name,
        terminology: prepared.board.itemTerminology,
        boardCreated: prepared.boardCreated,
        schemaAdded: prepared.boardCreated ? 0 : prepared.createdColumns + prepared.addedLabels,
        status: 'running',
      });
      void args.queryClient.invalidateQueries({ queryKey: queryKeys.board(args.orgId, prepared.board.id) });
      void args.queryClient.invalidateQueries({ queryKey: ['org', args.orgId, 'workspaces'] });
      void args.queryClient.invalidateQueries({ queryKey: ['org', args.orgId, 'boards'] });
    }
    const prepared = job.prepared;
    for (let start = current().processed; start < job.rows.length; start += IMPORT_LIMITS.batchSize) {
      if (current().cancelRequested) {
        patchRun(batchId, { status: 'cancelled', finishedAt: Date.now(), resumable: true });
        break;
      }
      const chunk = job.rows.slice(start, start + IMPORT_LIMITS.batchSize);
      const result = await send(() =>
        api.batch({
          batchId,
          boardId: prepared.board.id,
          groupId: prepared.groupId,
          fileName: job.fileName.slice(0, 255),
          dedupe: job.dedupe,
          createMissingLinks: true,
          rows: [...chunk],
        }),
      );
      const before = current();
      patchRun(batchId, {
        processed: before.processed + chunk.length,
        created: before.created + result.created,
        updated: before.updated + result.updated,
        skipped: before.skipped + result.skipped,
        linkedCreated: before.linkedCreated + result.linkedCreated,
        failures: [...before.failures, ...result.failed],
      });
    }
    const final = current();
    if (final.status === 'cancelled') return;
    patchRun(batchId, { status: 'done', finishedAt: Date.now() });
    jobs.delete(batchId);
    // Counts are rebuilt on the server from the batch audit rows; completing twice is a no-op.
    void sendWithRetry(() => api.complete({ batchId, boardId: prepared.board.id }), { maxWaitMs: 10_000 }).catch(() => undefined);
    void args.queryClient.invalidateQueries({ queryKey: queryKeys.board(args.orgId, prepared.board.id) });
    void args.queryClient.invalidateQueries({ queryKey: queryKeys.notificationsRoot(args.orgId) });
    if (backgrounded.has(batchId)) finishToast(current(), args.navigate);
  } catch (error) {
    const processed = current().processed;
    if (error instanceof RunInterrupted && error.reason === 'paused') {
      patchRun(batchId, { status: 'cancelled', finishedAt: Date.now(), resumable: true, reconnect: null });
      return;
    }
    patchRun(batchId, {
      reconnect: null,
      pausedOffline: error instanceof RunInterrupted && error.reason === 'offline',
      status: 'failed',
      error: friendlyFailure(error, processed, Boolean(job.prepared)),
      errorDetail: errorMessage(error, 'Unknown error'),
      resumable: true,
      finishedAt: Date.now(),
    });
    if (backgrounded.has(batchId)) {
      sonner.error('Import paused', {
        id: batchId,
        description: current().error ?? undefined,
        duration: 15_000,
        action: { label: 'Open', onClick: () => args.navigate(importRunHref(args.orgSlug, batchId)) },
      });
    }
  } finally {
    if (controllers.get(batchId) === controller) controllers.delete(batchId);
  }
}

export async function undoRun(
  batchId: string,
  queryClient: QueryClient,
  options: { readonly deleteBoard?: boolean } = {},
): Promise<void> {
  const run = useRunStore.getState().runs[batchId];
  if (!run?.boardId) return;
  const previous = run.status;
  useRunStore.getState().patch(batchId, { status: 'undoing' });
  try {
    const result = await importApi(run.orgId).undo({
      batchId,
      boardId: run.boardId,
      removeSchema: true,
      deleteBoard: Boolean(options.deleteBoard),
    });
    jobs.delete(batchId);
    useRunStore.getState().patch(batchId, { status: 'undone', undo: result, resumable: false });
    const parts = [
      result.archived ? `${result.archived.toLocaleString('en-US')} archived` : null,
      result.reverted ? `${result.reverted.toLocaleString('en-US')} restored` : null,
      result.removedColumns ? `${result.removedColumns} new ${result.removedColumns === 1 ? 'column' : 'columns'} removed` : null,
      result.boardDeleted ? 'board moved to trash' : null,
    ].filter(Boolean);
    sonner.success('Import undone', { description: parts.join(' · ') || 'Nothing needed undoing.' });
    void queryClient.invalidateQueries({ queryKey: queryKeys.board(run.orgId, run.boardId) });
    void queryClient.invalidateQueries({ queryKey: ['org', run.orgId, 'boards'] });
    void queryClient.invalidateQueries({ queryKey: ['org', run.orgId, 'workspaces'] });
  } catch (error) {
    useRunStore.getState().patch(batchId, { status: previous });
    sonner.error("Couldn't undo the import", { description: errorMessage(error) });
  }
}

export function cancelRun(batchId: string): void {
  useRunStore.getState().patch(batchId, { cancelRequested: true });
  // While reconnecting, stop now instead of after the next attempt.
  if (useRunStore.getState().runs[batchId]?.reconnect) controllers.get(batchId)?.abort(new RunInterrupted('paused'));
}

export function canResume(batchId: string): boolean {
  return jobs.has(batchId);
}
