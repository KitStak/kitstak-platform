'use client';

/**
 * Row kebab menu (Show Details / Edit / Change Log / Delete …). Disabled items carry a
 * reason tooltip; `href` items navigate with the router.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { MoreVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { RowAction } from './grid-types';

export function RowMenu({
  actions,
  label = 'Row actions',
}: {
  readonly actions: readonly RowAction[];
  readonly label?: string;
}) {
  const router = useRouter();
  if (actions.length === 0) return null;
  const firstDestructive = actions.findIndex((a) => a.destructive);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          onClick={(e) => e.stopPropagation()}
          className="opacity-70 hover:opacity-100 data-[state=open]:bg-neutral-soft data-[state=open]:opacity-100"
        >
          <MoreVertical className="h-4 w-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[180px]" onClick={(e) => e.stopPropagation()}>
        {actions.map((action, index) => (
          <React.Fragment key={action.key}>
            {index === firstDestructive && index > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem
              icon={action.icon}
              destructive={action.destructive}
              disabledReason={action.disabledReason}
              onSelect={() => {
                if (action.href) router.push(action.href);
                else action.onSelect?.();
              }}
            >
              {action.label}
            </DropdownMenuItem>
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
