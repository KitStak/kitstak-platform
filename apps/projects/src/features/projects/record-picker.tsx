'use client';
/**
 * Searchable picker for records in the sibling apps (CRM deals/accounts, shared customers, WMS
 * orders…). Searches live through /api/v1/integrations/search as you type. Used by the project
 * wizard ("Connect to CRM") and the Overview "Linked records" panel.
 */
import { useState, type ReactNode } from 'react';
import { Command } from 'cmdk';
import { Building2, Check, ChevronsUpDown, Handshake, Package, Search, Users, Warehouse } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger, Spinner, cn } from '@/components/ui';
import { INTEGRATION_TARGET_LABELS, type IntegrationTargetType } from '@/lib/constants';
import { useDebouncedValue } from '@/lib/hooks/use-debounced-value';
import { useIntegrationSearch, type ResolvedTargetDTO } from '@/lib/hooks/use-data';

export const TARGET_ICONS: Readonly<Record<IntegrationTargetType, ReactNode>> = {
  crm_item: <Handshake aria-hidden />,
  crm_account: <Building2 aria-hidden />,
  core_customer: <Users aria-hidden />,
  wms_order: <Package aria-hidden />,
  wms_work_order: <Warehouse aria-hidden />,
  wms_receipt: <Package aria-hidden />,
  wms_count: <Warehouse aria-hidden />,
};

const NOUN: Readonly<Record<IntegrationTargetType, string>> = {
  crm_item: 'deals',
  crm_account: 'accounts',
  core_customer: 'customers',
  wms_order: 'orders',
  wms_work_order: 'work orders',
  wms_receipt: 'receipts',
  wms_count: 'cycle counts',
};

const SEARCH_HINT: Readonly<Record<IntegrationTargetType, string>> = {
  crm_item: 'Search deals…',
  crm_account: 'Search accounts…',
  core_customer: 'Search customers…',
  wms_order: 'Search orders by number…',
  wms_work_order: 'Search work orders…',
  wms_receipt: 'Search receipts…',
  wms_count: 'Search cycle counts…',
};

export function RecordPicker({
  type,
  value,
  onChange,
  placeholder,
  trigger,
  className,
  excludeIds,
  align = 'start',
}: {
  readonly type: IntegrationTargetType;
  /** The picked record (null = none). */
  readonly value: ResolvedTargetDTO | null;
  readonly onChange: (record: ResolvedTargetDTO | null) => void;
  readonly placeholder?: string;
  readonly trigger?: ReactNode;
  readonly className?: string;
  readonly excludeIds?: readonly string[];
  readonly align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query, 200);
  const results = useIntegrationSearch(type, debounced, { enabled: open });
  const list = (results.data ?? []).filter((record) => !excludeIds?.includes(record.id));
  const label = INTEGRATION_TARGET_LABELS[type];

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <PopoverTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            aria-label={value ? `${label}: ${value.title}. Change` : (placeholder ?? `Pick a ${label.toLowerCase()}`)}
            className={cn(
              'inline-flex h-10 w-full items-center gap-2 rounded-md border border-border-input bg-panel px-3 text-left text-sm text-fg',
              'hover:border-border-input-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus [&_svg]:size-4 [&_svg]:shrink-0',
              className,
            )}
          >
            <span className="text-icon">{TARGET_ICONS[type]}</span>
            {value ? (
              <span className="min-w-0 flex-1 truncate">
                {value.title}
                {value.status ? <span className="ml-1.5 text-xs text-fg-muted">· {value.status}</span> : null}
              </span>
            ) : (
              <span className="min-w-0 flex-1 truncate text-fg-placeholder">{placeholder ?? `Pick a ${label.toLowerCase()}`}</span>
            )}
            <ChevronsUpDown aria-hidden className="text-icon" />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent align={align} className="w-[min(360px,calc(100vw-32px))] p-0">
        <Command shouldFilter={false} loop className="flex max-h-80 flex-col">
          <div className="flex items-center gap-2 border-b border-border-subtle px-3">
            <Search aria-hidden className="size-4 shrink-0 text-icon" />
            <Command.Input
              autoFocus
              value={query}
              onValueChange={setQuery}
              placeholder={SEARCH_HINT[type]}
              className="h-10 min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-placeholder"
            />
            {results.isFetching ? <Spinner size="sm" label={null} /> : null}
          </div>
          <Command.List className="min-h-0 flex-1 overflow-y-auto p-1">
            {!results.isFetching && list.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-fg-muted">{debounced ? `No ${NOUN[type]} match “${debounced}”` : `No ${NOUN[type]} yet`}</p>
            ) : null}
            {value ? (
              <Command.Item value="__clear__" onSelect={() => { onChange(null); setOpen(false); }} className="ks-menu-item text-fg-secondary">
                <span className="flex-1">Remove the {label.toLowerCase()}</span>
              </Command.Item>
            ) : null}
            {list.map((record) => (
              <Command.Item
                key={record.id}
                value={record.id}
                onSelect={() => {
                  onChange(record);
                  setOpen(false);
                }}
                className="ks-menu-item"
              >
                <span className="text-icon [&_svg]:size-4">{TARGET_ICONS[type]}</span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{record.title}</span>
                  {record.status || record.meta?.code ? (
                    <span className="truncate text-2xs text-fg-muted">{[record.meta?.code as string | undefined, record.status].filter(Boolean).join(' · ')}</span>
                  ) : null}
                </span>
                {value?.id === record.id ? <Check aria-hidden className="size-4 text-primary-text" /> : null}
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
