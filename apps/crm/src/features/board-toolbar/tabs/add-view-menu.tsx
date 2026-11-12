'use client';

/** "+" Add view menu (BV-003): every view type with an icon and a one-line description. */
import { Plus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  IconButton,
} from '@/components/ui';
import { VIEW_TYPES, type ViewTypeMeta } from '@/features/board-views';

/** Dashboards live on their own page; a board "dashboard" view has no renderer yet. */
const ADDABLE = VIEW_TYPES.filter((meta) => meta.type !== 'dashboard');

export interface AddViewMenuProps {
  readonly onAdd: (meta: ViewTypeMeta) => void;
  readonly disabled?: boolean;
  readonly pending?: boolean;
}

export function AddViewMenu({ onAdd, disabled, pending }: AddViewMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          label="Add view"
          icon={<Plus aria-hidden />}
          size="sm"
          disabled={disabled}
          loading={pending}
          data-testid="add-view-trigger"
          className="shrink-0"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[280px]" data-testid="add-view-menu">
        <DropdownMenuLabel>Add a view</DropdownMenuLabel>
        {ADDABLE.map((meta) => {
          const Icon = meta.icon;
          return (
            <DropdownMenuItem
              key={meta.type}
              icon={<Icon aria-hidden />}
              description={meta.description}
              onSelect={() => onAdd(meta)}
              data-testid={`add-view-${meta.type}`}
            >
              {meta.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
