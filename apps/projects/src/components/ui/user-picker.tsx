'use client';
import { useMemo, useState, type ReactNode } from 'react';
import { Command } from 'cmdk';
import { Check, Search, UserRound, UserX } from 'lucide-react';
import { Avatar } from './avatar';
import { cn } from './cn';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

export interface PickerPerson {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly image?: string | null;
}

interface UserPickerBase {
  readonly people: readonly PickerPerson[];
  /** The viewer: listed first as "Me". */
  readonly meId?: string;
  /** Custom trigger; defaults to an avatar + name field button. */
  readonly trigger?: ReactNode;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly align?: 'start' | 'center' | 'end';
  readonly 'aria-label'?: string;
  readonly className?: string;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
}

export interface UserPickerSingleProps extends UserPickerBase {
  readonly multiple?: false;
  readonly value: string | null;
  readonly onChange: (userId: string | null) => void;
  /** Offer "No one" (unassign). Default true. */
  readonly allowNone?: boolean;
}

export interface UserPickerMultiProps extends UserPickerBase {
  readonly multiple: true;
  readonly value: readonly string[];
  readonly onChange: (userIds: string[]) => void;
}

export type UserPickerProps = UserPickerSingleProps | UserPickerMultiProps;

/**
 * Searchable people picker (assignee, owner, followers, members). Keyboard: type to filter,
 * arrows to move, Enter to pick. Single mode closes on pick; multi mode toggles.
 */
export function UserPicker(props: UserPickerProps) {
  const { people, meId, trigger, placeholder = 'Assign', disabled, align = 'start', className } = props;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = props.open ?? internalOpen;
  const setOpen = (next: boolean) => {
    setInternalOpen(next);
    props.onOpenChange?.(next);
  };
  const ordered = useMemo(() => {
    const list = [...people];
    if (meId) {
      const index = list.findIndex((p) => p.id === meId);
      if (index > 0) list.unshift(...list.splice(index, 1));
    }
    return list;
  }, [people, meId]);
  const selected = new Set(props.multiple ? props.value : props.value ? [props.value] : []);
  const single = !props.multiple ? people.find((p) => p.id === props.value) : undefined;

  const pick = (id: string | null) => {
    if (props.multiple) {
      if (!id) return;
      const next = selected.has(id) ? props.value.filter((v) => v !== id) : [...props.value, id];
      props.onChange(next);
      return;
    }
    props.onChange(id);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        {trigger ?? (
          <button
            type="button"
            aria-label={props['aria-label'] ?? placeholder}
            className={cn(
              'inline-flex h-8 max-w-full items-center gap-2 rounded-md border border-border-input bg-panel px-2 text-sm text-fg',
              'hover:border-border-input-hover hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
              'disabled:pointer-events-none disabled:opacity-40',
              className,
            )}
          >
            {single ? (
              <>
                <Avatar name={single.name} src={single.image} size="xs" />
                <span className="truncate">{single.id === meId ? `${single.name} (me)` : single.name}</span>
              </>
            ) : props.multiple && props.value.length > 0 ? (
              <span className="truncate">{props.value.length} selected</span>
            ) : (
              <>
                <UserRound aria-hidden className="size-4 text-icon" />
                <span className="truncate text-fg-muted">{placeholder}</span>
              </>
            )}
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent align={align} className="w-72 p-0" onClick={(event) => event.stopPropagation()}>
        <Command loop className="flex max-h-80 flex-col">
          <div className="flex items-center gap-2 border-b border-border-subtle px-3">
            <Search aria-hidden className="size-4 shrink-0 text-icon" />
            <Command.Input
              autoFocus
              placeholder="Search people…"
              className="h-10 min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-placeholder"
            />
          </div>
          <Command.List className="min-h-0 flex-1 overflow-y-auto p-1">
            <Command.Empty className="px-3 py-6 text-center text-sm text-fg-muted">Nobody by that name</Command.Empty>
            {!props.multiple && props.allowNone !== false ? (
              <Command.Item value="__none__ no one unassign nobody" onSelect={() => pick(null)} className="ks-menu-item">
                <UserX aria-hidden />
                <span className="flex-1">No one</span>
                {props.value === null ? <Check aria-hidden className="size-4 text-primary-text" /> : null}
              </Command.Item>
            ) : null}
            {ordered.map((person) => (
              <Command.Item
                key={person.id}
                value={`${person.name} ${person.email} ${person.id}`}
                onSelect={() => pick(person.id)}
                className="ks-menu-item"
              >
                <Avatar name={person.name} src={person.image} size="xs" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{person.id === meId ? `${person.name} (me)` : person.name}</span>
                  <span className="truncate text-2xs text-fg-muted">{person.email}</span>
                </span>
                {selected.has(person.id) ? <Check aria-hidden className="size-4 text-primary-text" /> : null}
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
