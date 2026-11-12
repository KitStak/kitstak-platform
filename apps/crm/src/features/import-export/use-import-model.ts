'use client';
/** Derived wizard model: sheet → headers → profiles → plan → rows/issues, memoized per input. */
import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useBoard, useMembers, useOrgId, useWorkspaces } from '@/lib/hooks';
import { normalizeMatchKey } from '@/server/services/import-export-contracts';
import { importApi } from './api';
import type { ColumnDto, GroupDto, UserSummaryDto } from '@/server/services/contracts/dto';
import { resolveDestination, type Destination } from './lib/destination';
import { currencyFromCompanion, detectExportHelpers } from './lib/export-headers';
import { buildHeaders, memberMatcher, profileColumns } from './lib/infer';
import { autoMap, validateMapping, type MappingProblem } from './lib/mapping';
import { buildColumnPlan, buildRows, type BuiltRows, type ColumnPlan } from './lib/plan';
import { IMPORT_LIMITS, type ColumnProfile, type DedupeConfig, type MemberRef, type TargetColumn } from './lib/types';
import { useDraftStore, type ImportDraft } from './store';

export interface ImportModel {
  readonly draft: ImportDraft;
  /** Draft destination with derived defaults (first workspace) filled in. */
  readonly destination: Destination;
  readonly workspacesLoading: boolean;
  /** Effective duplicate handling (match key follows the mapping unless the user chose one). */
  readonly dedupe: DedupeConfig;
  /** Text-like mapped columns that can serve as a match key, best first. */
  readonly keyColumns: readonly TargetColumn[];
  readonly membersLoading: boolean;
  /** Duplicate check against the board (existing boards with skip/update only). */
  readonly match: MatchSummary;
  /** Rows that update an existing item (null while the check runs or when not deduping). */
  readonly matchedCount: number | null;
  readonly headers: readonly string[];
  readonly dataRows: readonly (readonly string[])[];
  readonly firstRowNumber: number;
  readonly totalRows: number;
  readonly truncated: boolean;
  readonly profiles: readonly ColumnProfile[];
  readonly boardId: string | null;
  readonly boardLoading: boolean;
  readonly boardError: boolean;
  readonly boardName: string | null;
  readonly terminology: string;
  readonly boardColumns: readonly ColumnDto[];
  readonly targetColumns: readonly TargetColumn[];
  readonly groups: readonly GroupDto[];
  readonly members: readonly MemberRef[];
  readonly users: readonly UserSummaryDto[];
  readonly plan: ColumnPlan;
  readonly built: BuiltRows;
  readonly mappingProblems: readonly MappingProblem[];
  readonly savedMapping: Readonly<Record<string, string>>;
}

const KIND_TERMS: Record<string, string> = {
  leads: 'Lead',
  contacts: 'Contact',
  accounts: 'Account',
  deals: 'Deal',
  activities: 'Activity',
  projects: 'Project',
  custom: 'Item',
};

export interface MatchSummary {
  readonly enabled: boolean;
  readonly pending: boolean;
  readonly error: unknown;
  /** Rows matching an existing item. */
  readonly matched: number;
  /** Rows repeating an earlier row of the file (merged into the first one). */
  readonly repeats: number;
  /** Rows that become new items. */
  readonly create: number;
}

export function pluralize(term: string, count: number): string {
  const lower = term.toLowerCase();
  if (count === 1) return lower;
  if (lower.endsWith('y') && !/[aeiou]y$/.test(lower)) return `${lower.slice(0, -1)}ies`;
  return lower.endsWith('s') ? lower : `${lower}s`;
}

export function useImportModel(scope: string): ImportModel {
  const draft = useDraftStore((state) => state.drafts[scope]) as ImportDraft;
  const update = useDraftStore((state) => state.update);
  const boardId = draft.destination.type === 'existing' ? draft.destination.boardId : null;
  const board = useBoard(boardId ?? undefined);
  const membersQuery = useMembers();
  const workspaces = useWorkspaces();
  const destination = useMemo(
    () => resolveDestination(draft.destination, workspaces.data?.[0]?.id ?? null),
    [draft.destination, workspaces.data],
  );

  const members = useMemo<MemberRef[]>(
    () => (membersQuery.data ?? []).map((member) => ({ userId: member.userId, name: member.name, email: member.email })),
    [membersQuery.data],
  );
  const users = useMemo<UserSummaryDto[]>(
    () =>
      (membersQuery.data ?? []).map((member) => ({
        id: member.userId,
        name: member.name,
        email: member.email,
        image: member.image,
        title: member.title,
      })),
    [membersQuery.data],
  );

  const sheet = draft.file?.sheets[draft.sheetIndex] ?? draft.file?.sheets[0];
  const rows = useMemo(() => sheet?.rows ?? [], [sheet]);
  const headers = useMemo(() => buildHeaders(rows, draft.headerRow), [rows, draft.headerRow]);
  const dataRows = useMemo(
    () => rows.slice(draft.headerRow + 1, draft.headerRow + 1 + IMPORT_LIMITS.maxRows),
    [rows, draft.headerRow],
  );
  const profiles = useMemo(() => profileColumns(headers, dataRows, { members }), [headers, dataRows, members]);

  const boardColumns = useMemo(
    () => (boardId && board.data ? board.data.columns.filter((column) => column.scope === 'item') : []),
    [boardId, board.data],
  );
  const targetColumns = useMemo<TargetColumn[]>(
    () => boardColumns.map((column) => ({ key: column.key, title: column.title, type: column.type, settings: column.settings })),
    [boardColumns],
  );
  const savedMapping = useMemo(() => {
    const raw = (board.data?.board.settings as { importMapping?: unknown } | undefined)?.importMapping;
    return raw && typeof raw === 'object' ? (raw as Record<string, string>) : {};
  }, [board.data]);

  // (Re)build the auto-mapping whenever the sheet, header row or destination board changes.
  const signature = draft.file
    ? `${draft.file.fileName}|${draft.sheetIndex}|${draft.headerRow}|${boardId ?? 'new'}|${boardColumns.length}|${members.length}`
    : null;
  const boardReady = (!boardId || Boolean(board.data)) && !membersQuery.isPending;
  useEffect(() => {
    if (!signature || !boardReady || draft.mappingFor === signature) return;
    update(scope, { mappings: autoMap(profiles, targetColumns, savedMapping), mappingFor: signature, overrides: {}, excludedRows: [] });
  }, [signature, boardReady, draft.mappingFor, profiles, targetColumns, savedMapping, scope, update]);

  const plan = useMemo(
    () => buildColumnPlan(draft.mappings, profiles, targetColumns, dataRows, { maxLabels: IMPORT_LIMITS.maxStatusLabels }),
    [draft.mappings, profiles, targetColumns, dataRows],
  );
  const matchMember = useMemo(() => memberMatcher(members), [members]);
  const currencyCompanions = useMemo(() => detectExportHelpers(headers).currencyCodes, [headers]);
  const keyColumns = useMemo(() => {
    const mappedKeys = new Set(
      draft.mappings.flatMap((mapping) => (mapping.target.kind === 'existing' ? [mapping.target.columnKey] : [])),
    );
    const rank: Record<string, number> = { email: 0, phone: 1, link: 2, text: 3 };
    return targetColumns
      .filter((column) => mappedKeys.has(column.key) && column.type in rank)
      .sort((a, b) => (rank[a.type] ?? 9) - (rank[b.type] ?? 9));
  }, [draft.mappings, targetColumns]);
  const dedupe = useMemo<DedupeConfig>(() => {
    if (draft.destination.type !== 'existing') return { mode: 'create', key: null };
    if (draft.dedupeKeyChosen && draft.dedupe.key) return draft.dedupe;
    const auto = keyColumns.find((column) => column.type !== 'text')?.key ?? 'name';
    return { mode: draft.dedupe.mode, key: auto };
  }, [draft.destination.type, draft.dedupe, draft.dedupeKeyChosen, keyColumns]);
  const firstRowNumber = draft.headerRow + 2;
  const dateOrders = useMemo(() => new Map(profiles.map((profile) => [profile.index, profile])), [profiles]);
  const built = useMemo(() => {
    // Each column converts with its own detected date order / currency.
    const perColumn = buildRows({
      dataRows,
      firstRowNumber,
      plan,
      headers,
      ctx: {
        dateOrder: 'mdy',
        currency: 'USD',
        matchMember,
      },
      overrides: draft.overrides,
      excludedRows: new Set(draft.excludedRows),
      skipRowsWithIssues: draft.skipRowsWithIssues,
      dedupe,
      columnContext: (sourceIndex, source) => {
        const profile = dateOrders.get(sourceIndex);
        const companion = currencyCompanions.get(sourceIndex);
        const rowCurrency = companion === undefined ? null : currencyFromCompanion(source[companion]);
        return { dateOrder: profile?.dateOrder ?? 'mdy', currency: profile?.currency ?? 'USD', rowCurrency, matchMember };
      },
    });
    return perColumn;
  }, [dataRows, firstRowNumber, plan, headers, matchMember, draft.overrides, draft.excludedRows, draft.skipRowsWithIssues, dedupe, dateOrders, currencyCompanions]);

  const orgId = useOrgId();
  const keys = useMemo(() => built.rows.map((row) => row.key ?? '').filter(Boolean), [built.rows]);
  // The check runs in the background as soon as an existing board is mapped (even while the mode is
  // still "always create"), so switching to skip / update on Review is instant.
  const matchFetchable = draft.destination.type === 'existing' && Boolean(boardId) && Boolean(dedupe.key) && keys.length > 0;
  const matchEnabled = matchFetchable && dedupe.mode !== 'create';
  const matchQuery = useQuery({
    queryKey: ['org', orgId, 'import-match', boardId, dedupe.key, keys.length, keys.slice(0, 3).join('|'), keys.at(-1)],
    queryFn: () => importApi(orgId).match({ boardId: boardId as string, key: dedupe.key as string, values: keys }),
    enabled: matchFetchable && draft.mappingFor !== null,
    staleTime: 60_000,
  });
  const match = useMemo<MatchSummary>(() => {
    const existing = new Set(matchQuery.data?.matched ?? []);
    const seen = new Set<string>();
    let matched = 0;
    let repeats = 0;
    let create = 0;
    for (const row of built.rows) {
      const key = row.key ? normalizeMatchKey(row.key) : '';
      if (key && matchEnabled && existing.has(key)) matched += 1;
      else if (key && seen.has(key) && dedupe.mode !== 'create') repeats += 1;
      else create += 1;
      if (key) seen.add(key);
    }
    return { enabled: matchEnabled, pending: matchEnabled && matchQuery.isPending, error: matchQuery.error, matched, repeats, create };
  }, [matchQuery.data, matchQuery.isPending, matchQuery.error, built.rows, matchEnabled, dedupe.mode]);

  const mappingProblems = useMemo(() => validateMapping(draft.mappings, targetColumns), [draft.mappings, targetColumns]);
  const kindTerm = draft.destination.type === 'new' ? (KIND_TERMS[draft.destination.kind] ?? 'Item') : 'Item';

  return {
    draft,
    destination,
    workspacesLoading: draft.destination.type === 'new' && workspaces.isPending,
    dedupe,
    keyColumns,
    membersLoading: membersQuery.isPending,
    match,
    matchedCount: matchEnabled ? (match.pending ? null : match.matched) : 0,
    headers,
    dataRows,
    firstRowNumber,
    totalRows: Math.min(sheet ? sheet.totalRows - (draft.headerRow + 1) : 0, IMPORT_LIMITS.maxRows),
    truncated: Boolean(sheet && (sheet.truncated || sheet.totalRows - (draft.headerRow + 1) > IMPORT_LIMITS.maxRows)),
    profiles,
    boardId,
    boardLoading: Boolean(boardId) && board.isPending,
    boardError: Boolean(boardId) && board.isError,
    boardName: board.data?.board.name ?? null,
    terminology: board.data?.board.itemTerminology ?? kindTerm,
    boardColumns,
    targetColumns,
    groups: board.data?.groups.filter((group) => !group.archivedAt) ?? [],
    members,
    users,
    plan,
    built,
    mappingProblems,
    savedMapping,
  };
}
