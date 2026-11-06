'use client';
/**
 * Local "board" state for the gallery: optimistic commits (with an optional simulated failure
 * that rolls back with a toast), label edits with reassignment, and mocked services.
 */
import { useCallback, useMemo, useState } from 'react';
import type { CellCommitValue, CellServices, LabelChange } from '@/features/cells';
import type { ColumnDto, FileDto, ItemDto } from '@/server/services/contracts/dto';
import { BOARD_ID, COLUMNS, GROUPS, CONNECTABLE, EMPTY_ITEM, FILES, ITEMS, PLACES, PRIORITY_COLUMN, TEAMS } from './fixtures';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function withValue(item: ItemDto, column: ColumnDto, value: CellCommitValue): ItemDto {
  if (column.type === 'name') return { ...item, name: typeof value === 'string' ? value : item.name };
  const values = { ...item.values };
  if (value === null) delete values[column.key];
  else values[column.key] = value;
  return { ...item, values, updatedAt: new Date().toISOString() };
}

function reassignValues(item: ItemDto, column: ColumnDto, change: LabelChange): ItemDto {
  const raw = item.values[column.key] as { labelId?: string; labelIds?: string[] } | undefined;
  if (!raw) return item;
  if (column.type === 'status' && raw.labelId && change.reassign.has(raw.labelId)) {
    const target = change.reassign.get(raw.labelId) ?? null;
    return withValue(item, column, target ? { labelId: target } : null);
  }
  if (column.type === 'dropdown' && raw.labelIds?.some((id) => change.reassign.has(id))) {
    const next = [...new Set(raw.labelIds.map((id) => (change.reassign.has(id) ? change.reassign.get(id) : id)).filter((id): id is string => Boolean(id)))];
    return withValue(item, column, next.length ? { labelIds: next } : null);
  }
  return item;
}

export function useGalleryBoard() {
  const [columns, setColumns] = useState<ColumnDto[]>(() => {
    const list = [...COLUMNS];
    const statusIndex = list.findIndex((column) => column.type === 'status');
    list.splice(statusIndex + 1, 0, PRIORITY_COLUMN);
    return list;
  });
  const [items, setItems] = useState<ItemDto[]>(() => [...ITEMS]);
  const [emptyItem, setEmptyItem] = useState<ItemDto>(EMPTY_ITEM);
  const [failSaves, setFailSaves] = useState(false);
  const [uploaded, setUploaded] = useState<FileDto[]>([]);

  const commit = useCallback((item: ItemDto, column: ColumnDto, value: CellCommitValue) => {
    const apply = (target: ItemDto) => withValue(target, column, value);
    const previous = item;
    if (item.id === EMPTY_ITEM.id) setEmptyItem((current) => apply(current));
    else setItems((current) => current.map((entry) => (entry.id === item.id ? apply(entry) : entry)));
    if (!failSaves) return Promise.resolve();
    return wait(450).then(() => {
      setItems((current) => current.map((entry) => (entry.id === item.id ? previous : entry)));
      setEmptyItem((current) => (current.id === item.id ? previous : current));
      // Reject after rolling back: <Cell> reports it (default error toast) and skips its Undo toast.
      throw new Error('The server rejected the change, so it was reverted.');
    });
  }, [failSaves]);

  const saveLabels = useCallback(async (column: ColumnDto, change: LabelChange) => {
    await wait(350);
    setItems((current) => current.map((item) => reassignValues(item, column, change)));
    setColumns((current) =>
      current.map((entry) => (entry.id === column.id ? { ...entry, settings: { labels: [...change.labels] } as ColumnDto['settings'] } : entry)),
    );
  }, []);

  const services = useMemo<CellServices>(
    () => ({
      teams: TEAMS,
      files: [...FILES, ...uploaded],
      uploadFile: async (item, column, file) => {
        await wait(900);
        const dto: FileDto = {
          id: crypto.randomUUID(),
          name: file.name,
          mime: file.type || 'application/octet-stream',
          size: file.size,
          boardId: BOARD_ID,
          itemId: item.id,
          updateId: null,
          columnKey: column.key,
          uploadedBy: null,
          createdAt: new Date().toISOString(),
          url: '',
        };
        setUploaded((current) => [...current, dto]);
        return dto;
      },
      searchItems: async (query, _boardIds, signal) => {
        await wait(250);
        if (signal?.aborted) return [];
        const needle = query.toLowerCase();
        return CONNECTABLE.filter((entry) => entry.name.toLowerCase().includes(needle));
      },
      linkedItems: new Map(CONNECTABLE.map((entry) => [entry.id, entry])),
      geocode: async (query, signal) => {
        await wait(350);
        if (signal?.aborted) return [];
        const needle = query.toLowerCase();
        return PLACES.filter((place) => place.address.toLowerCase().includes(needle)).slice(0, 5);
      },
      labelUsage: async (column) => {
        await wait(150);
        const counts: Record<string, number> = {};
        for (const item of items) {
          const raw = item.values[column.key] as { labelId?: string; labelIds?: string[] } | undefined;
          for (const id of raw?.labelIds ?? (raw?.labelId ? [raw.labelId] : [])) counts[id] = (counts[id] ?? 0) + 1;
        }
        return counts;
      },
      scopeKey: 'gallery',
      runButton: async (_column, item) => {
        await wait(700);
        return `Quote sent for ${item.name}`;
      },
      saveLabels,
      saveColumnSettings: async (column, settings) => {
        await wait(200);
        setColumns((current) => current.map((entry) => (entry.id === column.id ? { ...entry, settings } : entry)));
      },
      boardItems: items,
      tagSuggestions: ['expansion', 'multi-year', 'champion-left'],
    }),
    [items, saveLabels, uploaded],
  );

  const board = useMemo(
    () => ({ id: BOARD_ID, itemTerminology: 'Deal', columns, groups: GROUPS, canEdit: true }),
    [columns],
  );

  return { columns, items, emptyItem, commit, services, board, failSaves, setFailSaves };
}
