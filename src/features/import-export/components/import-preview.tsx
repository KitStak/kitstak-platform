'use client';
/**
 * Live preview of the first rows exactly as they will land, rendered with the board's real
 * cell renderers (read-only). Falls back to plain text if a renderer throws.
 */
import { Component, useMemo, type ReactNode } from 'react';
import { Cell } from '@/features/cells/cell';
import type { ColumnDto, ItemDto, UserSummaryDto } from '@/server/services/contracts/dto';
import type { ColumnSettings } from '@/server/db/schema/cell-values';
import { COLUMN_TYPE_REGISTRY } from '@/server/db/schema/column-types';
import type { ColumnPlan } from '../lib/plan';
import type { ImportRowPayload } from '../lib/types';
import { cn } from '@/components/ui';
import { ScrollFade } from './scroll-fade';

class CellBoundary extends Component<{ readonly fallback: ReactNode; readonly children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

const NOOP = () => undefined;

/** Preview column widths by type, so short values never truncate and long ones get room. */
const PREVIEW_WIDTH: Partial<Record<ColumnDto['type'], number>> = {
  name: 200,
  email: 220,
  link: 200,
  phone: 160,
  status: 140,
  dropdown: 160,
  people: 120,
  currency: 120,
  number: 110,
  rating: 120,
  date: 120,
  timeline: 180,
  checkbox: 90,
  country: 140,
  tags: 180,
  long_text: 240,
  location: 200,
};

export function previewWidth(type: ColumnDto['type']): number {
  return PREVIEW_WIDTH[type] ?? 160;
}

function toColumnDto(key: string, title: string, type: ColumnDto['type'], settings: unknown, index: number): ColumnDto {
  return {
    id: `preview-${key}`,
    boardId: 'preview',
    key,
    title,
    description: null,
    type,
    scope: 'item',
    settings: settings as ColumnSettings,
    width: COLUMN_TYPE_REGISTRY[type].defaultWidth,
    position: String(index).padStart(4, '0'),
    hidden: false,
    required: false,
  };
}

export interface ImportPreviewProps {
  readonly plan: ColumnPlan;
  readonly rows: readonly ImportRowPayload[];
  readonly terminology: string;
  readonly nameTitle: string;
  readonly users: readonly UserSummaryDto[];
}

export function ImportPreview({ plan, rows, terminology, nameTitle, users }: ImportPreviewProps) {
  const columns = useMemo(
    () => [
      toColumnDto('name', nameTitle || terminology, 'name', {}, 0),
      ...plan.columns.map((entry, index) =>
        toColumnDto(entry.column.key, entry.column.title, entry.column.type, entry.column.settings, index + 1),
      ),
    ],
    [plan, nameTitle, terminology],
  );
  const now = useMemo(() => new Date().toISOString(), []);
  const items = useMemo<ItemDto[]>(
    () =>
      rows.slice(0, 5).map((row) => ({
        id: `preview-${row.row}`,
        boardId: 'preview',
        groupId: 'preview',
        parentItemId: null,
        name: row.name,
        position: String(row.row),
        values: Object.fromEntries(Object.entries(row.values).filter(([, value]) => value !== null)) as ItemDto['values'],
        computed: {},
        subitemCount: 0,
        updateCount: 0,
        createdBy: null,
        updatedBy: null,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        deletedAt: null,
      })),
    [rows, now],
  );

  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border-default px-4 py-6 text-center text-sm text-fg-secondary">
        No rows to preview yet. Map the item name column to see how rows will look.
      </p>
    );
  }

  const template = columns.map((column) => `${previewWidth(column.type)}px`).join(' ');
  // The sticky name column casts a shadow once rows scroll under it (like the board table).
  const sticky = (index: number) =>
    index === 0
      ? 'sticky left-0 z-[2] shadow-[1px_0_0_var(--border-subtle)] transition-shadow duration-[var(--duration-fast)] ease-out group-data-[scrolled=true]/scroll:shadow-[1px_0_0_var(--border-subtle),6px_0_8px_-4px_rgb(0_0_0/0.18)]'
      : '';
  return (
    <div className="overflow-hidden rounded-lg border border-border-subtle bg-panel" data-testid="import-preview">
      <ScrollFade label="Import preview, scroll sideways for more columns" startInset={columns[0] ? previewWidth(columns[0].type) : 0}>
        <div role="grid" aria-label="Import preview" aria-readonly="true" aria-rowcount={items.length + 1} aria-colcount={columns.length} className="w-max min-w-full">
          <div role="row" className="grid border-b border-border-subtle bg-sunken" style={{ gridTemplateColumns: template }}>
            {columns.map((column, index) => (
              <div
                key={column.key}
                role="columnheader"
                className={cn('flex h-9 items-center truncate border-r border-border-subtle bg-sunken px-3 text-sm font-semibold text-fg-secondary last:border-r-0', sticky(index))}
                title={column.title}
              >
                {column.title}
              </div>
            ))}
          </div>
          {items.map((item) => (
            <div
              key={item.id}
              role="row"
              className="grid border-b border-border-subtle last:border-b-0"
              style={{ gridTemplateColumns: template }}
            >
              {columns.map((column, index) => (
                <div key={column.key} className={cn('min-w-0 border-r border-border-subtle bg-panel last:border-r-0', sticky(index))}>
                  <CellBoundary
                    fallback={
                      <div role="gridcell" className="flex h-9 items-center truncate px-3 text-base text-fg">
                        {column.type === 'name' ? item.name : JSON.stringify(item.values[column.key] ?? '')}
                      </div>
                    }
                  >
                    <Cell column={column} item={item} users={users} readOnly onCommit={NOOP} tabIndex={-1} />
                  </CellBoundary>
                </div>
              ))}
            </div>
          ))}
        </div>
      </ScrollFade>
      {columns.length > 1 ? (
        <p className="border-t border-border-subtle bg-sunken px-3 py-1.5 text-xs text-fg-muted">
          {columns.length} columns · the first stays in place while you scroll sideways
        </p>
      ) : null}
    </div>
  );
}
