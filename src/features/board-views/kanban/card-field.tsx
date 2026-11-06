'use client';
/**
 * One labelled field on a Kanban card. Renders a cheap read-only value (no editor wiring, no tab
 * stop) and only mounts the editable <Cell> once the value is clicked — so a board of hundreds
 * of cards stays light. Values are right-aligned so every card reads as a tidy two-column list.
 */
import { memo, useState } from 'react';
import { Check } from 'lucide-react';
import { Avatar, StatusPill, cn, toLabelColor } from '@/components/ui';
import { cellDisplay } from '@/features/board-overview/cell-display';
import { Cell, type CellBoard } from '@/features/cells';
import type { ColumnDto, ItemDto, UserSummaryDto } from '@/server/services/contracts/dto';
import { todayIso } from '../lib/dates';

export interface CardFieldProps {
  readonly column: ColumnDto;
  readonly item: ItemDto;
  readonly board: CellBoard;
  readonly users: readonly UserSummaryDto[];
  readonly userMap: ReadonlyMap<string, UserSummaryDto>;
  readonly editable: boolean;
  /** Closed (done / won / lost) lanes don't nag about overdue dates. */
  readonly closed: boolean;
  readonly onCommit: (item: ItemDto, column: ColumnDto, value: unknown) => void;
}

function isOverdue(column: ColumnDto, item: ItemDto): boolean {
  if (column.type !== 'date' && column.type !== 'timeline') return false;
  const stored = item.values[column.key] as { date?: unknown; to?: unknown } | undefined;
  const due = column.type === 'date' ? stored?.date : stored?.to;
  return typeof due === 'string' && due.slice(0, 10) < todayIso();
}

function FieldValue({ column, item, userMap, closed }: Pick<CardFieldProps, 'column' | 'item' | 'userMap' | 'closed'>) {
  const display = cellDisplay(column, item, userMap);
  switch (display.kind) {
    case 'label':
      return <StatusPill label={display.label} color={toLabelColor(display.color)} className="h-6 max-w-full min-w-0 rounded-sm px-2 text-xs" />;
    case 'labels':
      return (
        <span className="flex min-w-0 justify-end gap-1 overflow-hidden">
          {display.labels.slice(0, 2).map((label) => (
            <StatusPill key={label.label} label={label.label} color={toLabelColor(label.color)} className="h-6 min-w-0 rounded-sm px-2 text-xs" />
          ))}
          {display.labels.length > 2 ? <span className="text-xs text-fg-muted">+{display.labels.length - 2}</span> : null}
        </span>
      );
    case 'people':
      return (
        <span className="flex -space-x-1.5" title={display.people.map((person) => person.name).join(', ')}>
          {display.people.slice(0, 3).map((person) => (
            <Avatar key={person.id} name={person.name} src={person.image ?? undefined} size="sm" className="ring-2 ring-panel" />
          ))}
          {display.people.length > 3 ? (
            <span className="inline-flex size-6 items-center justify-center rounded-full bg-sunken text-2xs font-semibold text-fg-secondary ring-2 ring-panel">
              +{display.people.length - 3}
            </span>
          ) : null}
        </span>
      );
    case 'check':
      return display.checked ? <Check aria-label="Checked" className="size-4 text-success" /> : <span className="text-sm text-fg-disabled">—</span>;
    case 'text': {
      const overdue = !closed && isOverdue(column, item);
      return (
        <span className={cn('block min-w-0 truncate text-right text-sm tabular-nums', overdue ? 'font-medium text-danger-text' : 'text-fg')} title={overdue ? `${display.text} (overdue)` : display.text}>
          {display.text}
          {overdue ? <span className="sr-only"> (overdue)</span> : null}
        </span>
      );
    }
    default:
      return <span className="text-sm text-fg-disabled">—</span>;
  }
}

export const CardField = memo(function CardField(props: CardFieldProps) {
  const { column, item, board, users, editable, onCommit } = props;
  const [editing, setEditing] = useState(false);
  return (
    <div className="flex h-7 items-center gap-2" data-testid="kanban-card-field" data-column-key={column.key}>
      <span className="w-[84px] shrink-0 truncate text-xs text-fg-muted" title={column.title}>
        {column.title}
      </span>
      {editing ? (
        <div
          className="flex min-w-0 flex-1 justify-end overflow-hidden rounded-sm [--ks-cell-h:28px] [&_.ks-cell]:justify-end [&_.ks-cell]:rounded-sm [&_.ks-cell]:text-right"
          onClick={(event) => event.stopPropagation()}
        >
          <Cell
            column={column}
            item={item}
            board={board}
            users={users}
            density="compact"
            editing
            onEditingChange={(next) => {
              if (!next) setEditing(false);
            }}
            onCommit={(value) => onCommit(item, column, value)}
          />
        </div>
      ) : (
        <div
          data-ks-cell=""
          className={cn(
            'flex h-7 min-w-0 flex-1 items-center justify-end rounded-sm px-1 transition-colors duration-[var(--duration-fast)] ease-out',
            editable && 'cursor-text hover:bg-hover active:bg-pressed',
          )}
          onClick={(event) => {
            if (!editable) return;
            event.stopPropagation();
            setEditing(true);
          }}
        >
          <FieldValue {...props} />
        </div>
      )}
    </div>
  );
});
