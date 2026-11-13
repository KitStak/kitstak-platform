'use client';
/**
 * "Display" menu (Linear-style) for the Board, List and Table: grouping / swimlanes, card
 * order, show done tasks, show subtasks. Radio + checkbox menu items, fully keyboard driven.
 */
import type { ReactNode } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
} from '@/components/ui';
import { ToolbarButton } from './toolbar-button';

export interface DisplayChoice {
  readonly label: string;
  readonly value: string;
  readonly options: readonly { readonly value: string; readonly label: string; readonly icon?: ReactNode }[];
  readonly onChange: (value: string) => void;
  readonly testId?: string;
}

export interface DisplayToggle {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly testId?: string;
}

export function DisplayMenu({
  choices,
  toggles,
  iconOnly,
  summary,
  footer,
}: {
  readonly choices: readonly DisplayChoice[];
  readonly toggles: readonly DisplayToggle[];
  readonly iconOnly: boolean;
  /** Short text shown on the button when something is non-default, e.g. "Swimlanes: Assignee". */
  readonly summary?: string | null;
  readonly footer?: ReactNode;
}) {
  const trigger = (
    <DropdownMenuTrigger asChild>
      <ToolbarButton icon={<SlidersHorizontal aria-hidden />} label="Display options" text={summary ?? 'Display'} iconOnly={iconOnly} active={Boolean(summary)} data-testid="display-menu" />
    </DropdownMenuTrigger>
  );
  return (
    <DropdownMenu>
      {iconOnly ? (
        <Tooltip content={summary ?? 'Display options'} side="bottom">
          {trigger}
        </Tooltip>
      ) : (
        trigger
      )}
      <DropdownMenuContent align="start" className="w-64" data-testid="display-menu-content">
        {choices.map((choice, index) => (
          <div key={choice.label}>
            {index > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel>{choice.label}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={choice.value} onValueChange={choice.onChange}>
              {choice.options.map((option) => (
                <DropdownMenuRadioItem key={option.value} value={option.value} icon={option.icon} data-testid={choice.testId ? `${choice.testId}-${option.value}` : undefined}>
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </div>
        ))}
        {toggles.length ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Show</DropdownMenuLabel>
            {toggles.map((toggle) => (
              <DropdownMenuCheckboxItem
                key={toggle.label}
                checked={toggle.checked}
                onCheckedChange={(checked) => toggle.onChange(checked === true)}
                onSelect={(event) => event.preventDefault()}
                data-testid={toggle.testId}
              >
                {toggle.label}
              </DropdownMenuCheckboxItem>
            ))}
          </>
        ) : null}
        {footer}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
