'use client';
import { Plus, RotateCw } from 'lucide-react';
import { Button, EmptyState, Skeleton } from '@/components/ui';
import { LAYOUT } from '../lib/rows';

const COLUMN_WIDTHS = [150, 130, 140, 130, 150, 120, 160];
const NAME_WIDTHS = ['62%', '48%', '71%', '55%', '66%', '44%', '59%', '68%', '52%', '61%'];

function SkeletonGroup({ rows, color }: { readonly rows: number; readonly color: string }) {
  return (
    <div className="flex flex-col" style={{ paddingLeft: LAYOUT.gutter }}>
      <div className="flex h-11 items-end gap-2 pb-2.5">
        <Skeleton width={18} height={18} rounded="sm" />
        <Skeleton width={180} height={16} rounded="full" />
      </div>
      <div className="flex">
        <span
          className="w-1.5 shrink-0 rounded-l-md"
          style={{ background: `var(--label-${color})`, opacity: 0.55 }}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-9 items-center gap-0 border-y border-border-subtle">
            <span className="w-9 shrink-0" />
            <span className="w-[300px] shrink-0 pl-3">
              <Skeleton width={64} height={10} rounded="full" />
            </span>
            {COLUMN_WIDTHS.map((width, index) => (
              <span
                key={index}
                className="flex h-full shrink-0 items-center justify-center border-l border-border-subtle"
                style={{ width }}
              >
                <Skeleton width={width * 0.45} height={10} rounded="full" />
              </span>
            ))}
          </div>
          {Array.from({ length: rows }, (_, row) => (
            <div key={row} className="flex h-9 items-center border-b border-border-subtle">
              <span className="flex w-9 shrink-0 justify-center">
                <Skeleton width={14} height={14} />
              </span>
              <span className="w-[300px] shrink-0 pr-6 pl-3">
                <Skeleton height={10} width={NAME_WIDTHS[row % NAME_WIDTHS.length]} rounded="full" />
              </span>
              {COLUMN_WIDTHS.map((width, index) => (
                <span
                  key={index}
                  className="flex h-full shrink-0 items-center justify-center border-l border-border-subtle px-2"
                  style={{ width }}
                >
                  {index === 0 ? (
                    <Skeleton width="100%" height={28} rounded="sm" />
                  ) : (
                    <Skeleton width={width * (0.3 + ((row + index) % 4) * 0.1)} height={10} rounded="full" />
                  )}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** First-paint skeleton shaped like the real table (two groups, header, rows). */
export function TableSkeleton() {
  return (
    <div
      data-skeleton=""
      aria-busy="true"
      aria-label="Loading board"
      className="flex flex-1 flex-col gap-8 overflow-hidden pt-3"
      data-testid="board-table-skeleton"
    >
      <SkeletonGroup rows={7} color="blue" />
      <SkeletonGroup rows={4} color="purple" />
    </div>
  );
}

export function TableError({ message, onRetry }: { readonly message: string; readonly onRetry: () => void }) {
  return (
    <EmptyState
      illustration="error"
      title="We couldn't load this board"
      description={message}
      actions={
        <Button leadingIcon={<RotateCw aria-hidden />} onClick={onRetry}>
          Try again
        </Button>
      }
      className="flex-1"
    />
  );
}

export function EmptyBoard({
  noun,
  canEdit,
  onAdd,
}: {
  readonly noun: string;
  readonly canEdit: boolean;
  readonly onAdd: () => void;
}) {
  return (
    <EmptyState
      illustration="board"
      title={`This board is empty — add your first ${noun.toLowerCase()}`}
      description={
        canEdit
          ? `${noun}s you add show up here, grouped and ready to track.`
          : 'Nothing has been added to this board yet.'
      }
      actions={
        canEdit ? (
          <Button leadingIcon={<Plus aria-hidden />} onClick={onAdd} data-testid="empty-board-add">
            New {noun.toLowerCase()}
          </Button>
        ) : null
      }
      className="py-10"
    />
  );
}
