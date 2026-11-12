'use client';

/**
 * Shared client pieces for the M14 admin pages: permission flags, admin options (roles,
 * warehouses, clients), filter-field mapping, bulk toasts, a JSON mutation hook, a change
 * log drawer for module `/change-log` endpoints, and detail lists.
 */
import * as React from 'react';
import { z } from 'zod';
import { ChevronLeft, ChevronRight, FilePlus2, PencilLine, Trash2 } from 'lucide-react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { apiRequest, isApiError } from '@/lib/api-client';
import { useApiQuery } from '@/lib/query-client';
import { useFormat } from '@/lib/format';
import { useMe, usePermissionSet } from '@/lib/permissions-client';
import { useShell } from '@/components/layout/shell-context';
import { cn } from '@/lib/utils';
import { bulkSummary, prettyLogMessage, sentenceCase, type AdminField } from '@/lib/grid-defs/admin/common';
import type { FilterFieldDef } from '@/components/grid';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonTable } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';

export interface Option {
  readonly value: string;
  readonly label: string;
}

export const NO_PERMISSION = "You don't have permission for this action";

/**
 * Pure merge of the two permission sources: `/api/me` once it has loaded, otherwise the set the
 * (app) layout resolved on the server for this request (`ShellProvider`). `/api/me` is a
 * refresh, never a gate — CTAs and kebabs render enabled on first paint (SSR included, so no
 * hydration mismatch). `loading` is true only when neither source is available.
 */
export function resolvePagePerms<A extends string>(
  page: string,
  actions: readonly A[],
  live: { readonly permissions: ReadonlySet<string>; readonly isLoading: boolean },
  seed: ReadonlySet<string> | null,
): Readonly<Record<A, boolean>> & { readonly loading: boolean } {
  const source = !live.isLoading ? live.permissions : seed;
  const out = Object.fromEntries(actions.map((a) => [a, source?.has(`${page}.${a}`) ?? false])) as Record<
    A,
    boolean
  >;
  return { ...out, loading: source === null };
}

/** Permission flags for one catalog page, e.g. `settings.users`. */
export function usePagePerms<A extends string>(
  page: string,
  actions: readonly A[],
): Readonly<Record<A, boolean>> & { readonly loading: boolean } {
  const live = usePermissionSet();
  const { permissions: seed } = useShell();
  return resolvePagePerms(page, actions, live, seed);
}

/** Signed-in user id: from `/api/me` when loaded, else the server-rendered shell session. */
export function useMeId(): string | null {
  const me = useMe();
  const { user } = useShell();
  return me.data?.data.user.id ?? user?.id ?? null;
}

const optionsSchema = z.object({
  roles: z.array(
    z.object({
      id: z.string(),
      key: z.string(),
      name: z.string(),
      category: z.string(),
      description: z.string().nullish(),
      isSystem: z.boolean(),
    }),
  ),
  warehouses: z.array(z.object({ id: z.string(), code: z.string(), name: z.string() })),
  clients: z.array(z.object({ id: z.string(), code: z.string(), name: z.string() })),
  users: z.array(z.object({ id: z.string(), name: z.string(), email: z.string() })).default([]),
});
export type AdminOptions = z.infer<typeof optionsSchema>;

const EMPTY_OPTIONS: AdminOptions = { roles: [], warehouses: [], clients: [], users: [] };

/** Roles, warehouses (caller scope) and clients for wizards and filters. */
export function useAdminOptions(): AdminOptions & { readonly loading: boolean } {
  const q = useApiQuery<unknown>(['admin-options'], '/api/users/options', { staleTime: 60_000 });
  const parsed = optionsSchema.safeParse(q.data?.data);
  return { ...(parsed.success ? parsed.data : EMPTY_OPTIONS), loading: q.isPending };
}

/** Pure field list -> filter-builder defs, with page-supplied options for id enums. */
export function toFilterFields(
  fields: readonly AdminField[],
  dynamic: Readonly<Record<string, readonly Option[]>> = {},
): readonly FilterFieldDef[] {
  return fields.map((f) => {
    const options =
      dynamic[f.field] ?? f.options?.map((v) => ({ value: v, label: v.includes('_') ? sentenceCase(v) : v }));
    return { field: f.field, label: f.label, type: f.type, ...(options ? { options } : {}) };
  });
}

/* ---------------- mutations ---------------- */

export interface BulkResponse {
  readonly succeeded: readonly string[];
  readonly failed: readonly { readonly id: string; readonly code: string; readonly message: string }[];
}

export function errorMessage(error: unknown): string {
  if (!isApiError(error)) return 'Something went wrong. Try again.';
  return error.code === 'CONFLICT' ? 'This record changed since you opened it — Reload' : error.message;
}

/** Runs a JSON mutation, toasts failures and invalidates queries. Returns data or null. */
export function useAction(invalidate: readonly QueryKey[]) {
  const qc = useQueryClient();
  const [pending, setPending] = React.useState(false);
  const run = React.useCallback(
    async <T,>(
      path: string,
      method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
      body?: unknown,
      onError?: (e: unknown) => void,
    ): Promise<T | null> => {
      setPending(true);
      try {
        const { data } = await apiRequest<T>(path, { method, body });
        // Reconcile in the background: callers close dialogs and patch rows as soon as the
        // mutation succeeds instead of waiting on a full list refetch.
        void Promise.all(invalidate.map((queryKey) => qc.invalidateQueries({ queryKey }))).catch(
          () => undefined,
        );
        return data;
      } catch (error) {
        if (onError) onError(error);
        else toast.error('Error', errorMessage(error));
        return null;
      } finally {
        setPending(false);
      }
    },
    [qc, invalidate],
  );
  return { run, pending };
}

/**
 * Optimistically patches every cached page of grid `gridKey` (`["grid", key, path, query]` →
 * `{ data: T[], meta }`). `fn` maps the rows; removed rows also lower `meta.total`. The background
 * invalidation in `useAction` reconciles with the server afterwards.
 */
export function useGridPatch<T extends { readonly id: string }>(gridKey: string) {
  const qc = useQueryClient();
  return React.useCallback(
    (fn: (rows: readonly T[]) => T[]) => {
      qc.setQueriesData<{ data: T[]; meta?: { total?: number } & Record<string, unknown> }>(
        { queryKey: ['grid', gridKey] },
        (old) => {
          if (!old || !Array.isArray(old.data)) return old;
          const next = fn(old.data);
          const removed = old.data.length - next.length;
          const meta =
            old.meta && typeof old.meta.total === 'number' && removed > 0
              ? { ...old.meta, total: Math.max(0, old.meta.total - removed) }
              : old.meta;
          return { ...old, data: next, meta };
        },
      );
    },
    [qc, gridKey],
  );
}

/**
 * Destructive styling only while the action can actually run: a disabled Delete / Deactivate
 * renders with the same neutral treatment as every other disabled control instead of a
 * saturated red button or a red menu icon that looks enabled. Pass `selectedIds` for bulk
 * actions (no selection or an ineligible one disarms it). PURE.
 */
export function armDestructive<
  A extends {
    readonly destructive?: boolean;
    readonly disabledReason?: string | null;
    readonly eligibility?: (ids: readonly string[]) => string | null;
  },
>(action: A, selectedIds?: readonly string[]): A {
  if (!action.destructive) return action;
  const blocked =
    Boolean(action.disabledReason) ||
    (selectedIds !== undefined && (selectedIds.length === 0 || Boolean(action.eligibility?.(selectedIds))));
  return blocked ? { ...action, destructive: false } : action;
}

/** "3 of 4 users activated · 1 failed" plus the first failure reasons. */
export function toastBulk(result: BulkResponse, noun: string, verb: string): void {
  const message = bulkSummary(result, noun, verb);
  if (result.failed.length === 0) {
    toast.success('Success', message);
    return;
  }
  const reasons = result.failed
    .slice(0, 3)
    .map((f) => f.message)
    .join(' · ');
  const more = result.failed.length > 3 ? ` (+${result.failed.length - 3} more)` : '';
  (result.succeeded.length === 0 ? toast.error : toast.warning)(
    result.succeeded.length === 0 ? 'Nothing changed' : 'Partly done',
    `${message}. ${reasons}${more}`,
  );
}

/* ---------------- change log (module endpoints) ---------------- */

const logEntry = z.object({
  id: z.string(),
  type: z.enum(['Create', 'Update', 'Delete']),
  message: z.string(),
  fieldLabel: z.string().nullish(),
  fromValue: z.string().nullish(),
  toValue: z.string().nullish(),
  source: z.string(),
  at: z.string(),
});

const TYPE_META = {
  Create: { icon: FilePlus2, tile: 'bg-success-soft text-success' },
  Update: { icon: PencilLine, tile: 'bg-info-soft text-info' },
  Delete: { icon: Trash2, tile: 'bg-danger-soft text-danger' },
} as const;

const LOG_PAGE = 20;
const LOG_SLOW_MS = 8000;

/** Paged change-log timeline (used by the change-log drawer and in-drawer "Change log" tabs). */
export function ChangeLogList({
  path,
  enabled = true,
}: {
  readonly path: string | null;
  readonly enabled?: boolean;
}) {
  const fmt = useFormat();
  const [page, setPage] = React.useState(1);
  const query = useApiQuery<unknown>(['admin-change-log', path ?? '', page], enabled && path ? path : null, {
    query: { page, ps: LOG_PAGE },
    placeholderData: (p) => p,
    staleTime: 0,
  });
  const parsed = z.array(logEntry).safeParse(query.data?.data);
  const rows = parsed.success ? parsed.data : [];
  const total = query.data?.meta?.total ?? rows.length;
  const pages = Math.max(1, Math.ceil(total / LOG_PAGE));
  const [slow, setSlow] = React.useState(false);
  const loading = query.isPending && enabled && Boolean(path);
  React.useEffect(() => {
    if (!loading) {
      setSlow(false);
      return undefined;
    }
    const t = window.setTimeout(() => setSlow(true), LOG_SLOW_MS);
    return () => window.clearTimeout(t);
  }, [loading]);
  return (
    <>
      {query.isPending ? (
        <div className="flex flex-col gap-3" role="status" aria-live="polite">
          <p className="text-xs text-secondary">
            {slow ? 'The history is taking longer than usual.' : 'Loading the history…'}
            {slow ? (
              <>
                {' '}
                <button
                  type="button"
                  className="font-semibold text-primary hover:underline"
                  onClick={() => void query.refetch()}
                >
                  Retry
                </button>
              </>
            ) : null}
          </p>
          <SkeletonTable rows={6} columns={4} />
        </div>
      ) : query.isError ? (
        <EmptyState
          title="Couldn't load the change log"
          description={query.error.message}
          action={<Button onClick={() => void query.refetch()}>Retry</Button>}
          compact
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No changes recorded yet"
          description="Edits to this record will appear here."
          compact
        />
      ) : (
        <div className="flex flex-col gap-3">
          <ol className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {rows.map((r) => {
              const meta = TYPE_META[r.type];
              const Icon = meta.icon;
              return (
                <li key={r.id} className="flex gap-3 px-3 py-2.5">
                  <span
                    className={cn(
                      'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
                      meta.tile,
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    {r.type === 'Update' && r.fieldLabel ? (
                      <p className="break-words text-sm text-body">
                        <span className="font-medium">{r.fieldLabel} changed:</span>{' '}
                        {r.fromValue ? (
                          <span className="text-faint line-through decoration-faint/60">{r.fromValue}</span>
                        ) : null}
                        {r.fromValue ? <span className="mx-1 text-faint">→</span> : null}
                        <span className="font-medium text-foreground">{r.toValue || '—'}</span>
                      </p>
                    ) : (
                      <p className="text-sm text-body">{prettyLogMessage(r.message)}</p>
                    )}
                    <p className="mt-0.5 text-2xs text-faint">
                      {fmt.gridDateTime(r.at)} · {r.source}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="flex items-center justify-between text-xs text-secondary">
            <span>Total: {total}</span>
            <div className="flex items-center gap-1">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Previous page"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="tabular-nums">
                {page} / {pages}
              </span>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Next page"
                disabled={page >= pages}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function EntityChangeLogDrawer({
  open,
  onOpenChange,
  path,
  title,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly path: string | null;
  readonly title: string;
}) {
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description="Every create, edit and delete with who made it and when."
      width={45}
    >
      {/* key resets paging when the record changes */}
      <ChangeLogList key={path ?? ''} path={path} enabled={open} />
    </Drawer>
  );
}

/* ---------------- detail lists ---------------- */

export interface DetailItem {
  readonly label: string;
  readonly value: React.ReactNode;
  readonly wide?: boolean;
}

export function Muted({ children }: { readonly children?: React.ReactNode }) {
  return <span className="text-faint">{children ?? '—'}</span>;
}

/** Two-column label/value grid used by the "Show details" drawers. */
export function DetailList({
  title,
  items,
}: {
  readonly title?: string;
  readonly items: readonly DetailItem[];
}) {
  return (
    <section className="flex flex-col gap-2">
      {title ? <h3 className="text-xs font-semibold text-secondary">{title}</h3> : null}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border border-border bg-surface px-4 py-3">
        {items.map((i) => (
          <div key={i.label} className={cn('min-w-0', i.wide && 'col-span-2')}>
            <dt className="text-2xs text-faint">{i.label}</dt>
            <dd className="mt-0.5 break-words text-sm text-foreground">
              {i.value === null || i.value === undefined || i.value === '' ? <Muted /> : i.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Small stat tiles across the top of a detail drawer or page. */
export function StatRow({
  stats,
}: {
  readonly stats: readonly {
    readonly label: string;
    readonly value: React.ReactNode;
    readonly tone?: 'danger' | 'warning' | 'success';
  }[];
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {stats.map((s) => (
        <div key={s.label} className="rounded-lg border border-border bg-surface-sunken/60 px-3 py-2">
          <p className="text-2xs text-faint">{s.label}</p>
          <p
            className={cn(
              'text-lg font-semibold tabular-nums text-foreground',
              s.tone === 'danger' && 'text-danger',
              s.tone === 'warning' && 'text-warning',
              s.tone === 'success' && 'text-success',
            )}
          >
            {s.value}
          </p>
        </div>
      ))}
    </div>
  );
}

/**
 * Header action placeholder while `/api/me` (permissions) is pending: a neutral skeleton the
 * size of a button, so a not-yet-known permission never renders as a filled primary button.
 */
export function PermissionPending({
  width = 104,
  label = 'Checking permissions',
}: {
  readonly width?: number;
  readonly label?: string;
}) {
  return (
    <span
      role="status"
      aria-label={label}
      className="inline-block h-8 animate-pulse rounded-md bg-neutral-soft"
      style={{ width }}
    />
  );
}
