'use client';
/**
 * The Client box of quick add: type to search the clients you have, press Enter to take the
 * highlighted one. A name close to a client you already have shows that client first ("Did you
 * mean"), and a new client is only ever made from the "Create" row, never from loose text.
 */
import { useId, useMemo, useState, type KeyboardEvent, type Ref } from 'react';
import { Check, Plus } from 'lucide-react';
import { Badge, Input, Popover, PopoverAnchor, PopoverContent } from '@/components/ui';
import { cn } from '@/components/ui/cn';
import { matchClientName } from '@/lib/client-names';
import type { ClientDTO } from '@/lib/types';

export interface ClientChoice {
  /** What the box shows. */
  readonly text: string;
  /** The client picked from the list, or null while the text is loose or names a new client. */
  readonly clientId: string | null;
  /** True once the person chose the "Create" row for this exact text. */
  readonly createNew: boolean;
}

export const NO_CLIENT: ClientChoice = { text: '', clientId: null, createNew: false };

type ClientLite = Pick<ClientDTO, 'id' | 'name' | 'code'>;

interface Row {
  readonly key: string;
  readonly client: ClientLite | null;
}

const MAX_ROWS = 8;

/** The rows for the typed text: clients that hold the text, then other look-alikes, then "Create". */
export function clientRows(
  text: string,
  clients: readonly ClientLite[],
): { readonly existing: readonly ClientLite[]; readonly canCreate: boolean; readonly lookAlike: boolean } {
  const typed = text.trim();
  if (!typed) return { existing: clients.slice(0, MAX_ROWS), canCreate: false, lookAlike: false };
  const lower = typed.toLowerCase();
  const match = matchClientName(typed, clients);
  const holds = clients.filter(
    (client) => client.name.toLowerCase().includes(lower) || client.code.toLowerCase().includes(lower),
  );
  const ordered: ClientLite[] = [];
  const add = (client: ClientLite) => {
    if (!ordered.some((item) => item.id === client.id)) ordered.push(client);
  };
  if (match.exact) add(match.exact);
  holds.filter((client) => client.name.toLowerCase().startsWith(lower)).forEach(add);
  match.lookAlikes.forEach(add);
  holds.forEach(add);
  return {
    existing: ordered.slice(0, MAX_ROWS),
    canCreate: match.exact === null,
    lookAlike: match.exact === null && match.lookAlikes.length > 0,
  };
}

export function ClientCombo({
  clients,
  value,
  onChange,
  onPicked,
  open,
  onOpenChange,
  invalid,
  inputRef,
  testId = 'client-combo',
}: {
  readonly clients: readonly ClientLite[];
  readonly value: ClientChoice;
  readonly onChange: (next: ClientChoice) => void;
  /** Called after a row is taken with Enter or a click, so the form can move to the next box. */
  readonly onPicked?: () => void;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly invalid?: boolean;
  readonly inputRef?: Ref<HTMLInputElement>;
  readonly testId?: string;
}) {
  const listId = useId();
  const [active, setActive] = useState(0);
  const typed = value.text.trim();
  const { existing, canCreate, lookAlike } = useMemo(() => clientRows(value.text, clients), [value.text, clients]);
  const rows: Row[] = useMemo(
    () => [
      ...existing.map((client) => ({ key: client.id, client })),
      ...(canCreate ? [{ key: 'create', client: null }] : []),
    ],
    [existing, canCreate],
  );
  const current = Math.min(active, Math.max(rows.length - 1, 0));
  const resolved = value.clientId !== null || value.createNew;

  const pick = (row: Row) => {
    if (row.client) onChange({ text: row.client.name, clientId: row.client.id, createNew: false });
    else onChange({ text: typed, clientId: null, createNew: true });
    onOpenChange(false);
    onPicked?.();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        onOpenChange(true);
        return;
      }
      if (rows.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current + step + rows.length) % rows.length);
      return;
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      onOpenChange(false);
      return;
    }
    if (event.key === 'Enter') {
      const row = rows[current];
      if (open && row) {
        // Enter takes the highlighted row. It never sends the form with loose text in this box.
        event.preventDefault();
        pick(row);
      } else if (!resolved && typed) {
        event.preventDefault();
        onOpenChange(true);
      }
    }
  };

  const optionId = (index: number) => `${listId}-option-${index}`;
  const createIndex = existing.length;

  return (
    <Popover open={open && rows.length > 0} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>
        <div>
          <Input
            ref={inputRef}
            role="combobox"
            aria-label="Client"
            aria-expanded={open && rows.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && rows[current] ? optionId(current) : undefined}
            value={value.text}
            onChange={(event) => {
              onChange({ text: event.target.value, clientId: null, createNew: false });
              setActive(0);
              onOpenChange(true);
            }}
            onFocus={() => {
              if (!resolved) onOpenChange(true);
            }}
            onClick={() => onOpenChange(true)}
            onBlur={() => {
              // Leaving the box with the exact name of a client typed takes that client.
              if (!resolved && typed) {
                const exact = matchClientName(typed, clients).exact;
                if (exact) onChange({ text: exact.name, clientId: exact.id, createNew: false });
              }
              onOpenChange(false);
            }}
            onKeyDown={onKeyDown}
            placeholder="Client"
            invalid={invalid}
            autoComplete="off"
            maxLength={200}
            data-testid={testId}
            data-client-id={value.clientId ?? undefined}
            trailing={
              value.createNew ? (
                <Badge tone="info" size="sm">
                  New
                </Badge>
              ) : value.clientId ? (
                <Check aria-hidden className="size-4 text-success" />
              ) : undefined
            }
          />
        </div>
      </PopoverAnchor>
      <PopoverContent
        flush
        aria-label="Pick a client"
        className="w-[max(var(--radix-popover-trigger-width),280px)]"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          // A click in the box itself keeps the list open (the box handles its own focus).
          const target = event.target;
          if (target instanceof Element && target.closest(`[aria-controls="${listId}"]`)) event.preventDefault();
        }}
      >
        <div
          id={listId}
          role="listbox"
          aria-label="Clients"
          className="max-h-72 overflow-y-auto p-1.5"
          data-testid={`${testId}-list`}
        >
          {existing.length > 0 ? (
            <div role="group" aria-label={lookAlike ? 'Did you mean' : 'Your clients'}>
              {typed && canCreate ? (
                <div
                  role="presentation"
                  className="px-2.5 pt-1 pb-1.5 text-xs font-medium text-fg-muted"
                  data-testid={`${testId}-hint`}
                >
                  {existing.length === 1
                    ? `Did you mean ${existing[0]?.name ?? ''}?`
                    : 'Did you mean one of these?'}
                </div>
              ) : null}
              {existing.map((client, index) => (
                <div
                  key={client.id}
                  id={optionId(index)}
                  role="option"
                  aria-selected={current === index}
                  className="ks-menu-item cursor-pointer"
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => pick({ key: client.id, client })}
                  data-testid={`${testId}-option`}
                >
                  <span className="min-w-0 flex-1 truncate">{client.name}</span>
                  <span className="shrink-0 text-xs text-fg-muted">{client.code}</span>
                </div>
              ))}
            </div>
          ) : null}
          {canCreate ? (
            <div
              role="group"
              aria-label="New client"
              className={cn(existing.length > 0 && 'mt-1.5 border-t border-border-subtle pt-1.5')}
            >
              <div
                id={optionId(createIndex)}
                role="option"
                aria-selected={current === createIndex}
                className="ks-menu-item cursor-pointer"
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(createIndex)}
                onClick={() => pick({ key: 'create', client: null })}
                data-testid={`${testId}-create`}
              >
                <Plus aria-hidden />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">Create &quot;{typed}&quot;</span>
                  <span className="text-xs text-fg-muted">
                    {existing.length > 0 ? 'Only if this is a different client' : 'A new client'}
                  </span>
                </span>
              </div>
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
