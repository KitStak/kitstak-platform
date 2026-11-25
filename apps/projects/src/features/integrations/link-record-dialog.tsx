'use client';
/**
 * "Link a record" dialog: pick what kind of record (CRM deal, account, customer, WMS order,
 * work order, receipt, cycle count; only the kinds this workspace can use), search it live and
 * link it to a task or a project. Already-linked records are marked and can't be added twice.
 *
 *   <LinkRecordDialog open onOpenChange owner={{ taskId }} existing={task.links} onLinked={…} />
 */
import { useMemo, useState } from 'react';
import { Command } from 'cmdk';
import { Check, Link2, Search } from 'lucide-react';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  Button,
  Spinner,
  cn,
} from '@/components/ui';
import type { IntegrationTargetType } from '@/lib/constants';
import { useDebouncedValue } from '@/lib/hooks/use-debounced-value';
import { useServerAction } from '@/lib/hooks/use-action';
import { useIntegrationSearch, useIntegrationStatus, type ResolvedTargetDTO } from '@/lib/hooks/use-data';
import type { IntegrationLinkDTO } from '@/lib/types';
import { addLinkAction } from '@/server/actions/links';
import { RecordStatus, SiblingAppMark } from './record-chip';
import { targetApp } from './status-tone';

const SHORT: Readonly<Record<IntegrationTargetType, string>> = {
  crm_item: 'Deals',
  crm_account: 'Accounts',
  core_customer: 'Customers',
  wms_order: 'Orders',
  wms_work_order: 'Work orders',
  wms_receipt: 'Receipts',
  wms_count: 'Counts',
};

const HINT: Readonly<Record<IntegrationTargetType, string>> = {
  crm_item: 'Search deals by name…',
  crm_account: 'Search accounts by name…',
  core_customer: 'Search customers by name or code…',
  wms_order: 'Search orders by number or customer…',
  wms_work_order: 'Search work orders by number…',
  wms_receipt: 'Search receipts by PO number…',
  wms_count: 'Search cycle counts…',
};

export type LinkOwner = { readonly taskId: string } | { readonly projectId: string };

interface LinkRecordDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly owner: LinkOwner;
  readonly existing?: readonly Pick<IntegrationLinkDTO, 'targetType' | 'targetId'>[];
  readonly initialType?: IntegrationTargetType;
  readonly onLinked?: (link: IntegrationLinkDTO) => void;
}

export function LinkRecordDialog(props: LinkRecordDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {/* Content mounts only while open, so every opening starts with a fresh search. */}
      <DialogContent size="md" data-testid="link-record-dialog">
        <LinkRecordBody {...props} />
      </DialogContent>
    </Dialog>
  );
}

function LinkRecordBody({
  open,
  onOpenChange,
  owner,
  existing = [],
  initialType,
  onLinked,
}: LinkRecordDialogProps) {
  const status = useIntegrationStatus({ enabled: open, staleTime: 60_000 });
  const types = useMemo(() => status.data?.targetTypes ?? [], [status.data]);
  const [type, setType] = useState<IntegrationTargetType | null>(initialType ?? null);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<ResolvedTargetDTO | null>(null);
  const debounced = useDebouncedValue(query, 200);
  const active =
    type && types.includes(type) ? type : (types.find((t) => t !== 'core_customer') ?? types[0] ?? null);
  const results = useIntegrationSearch(active ?? 'core_customer', debounced, {
    enabled: open && active !== null,
  });
  const add = useServerAction(addLinkAction, {
    successMessage: (link) => `Linked ${link.title ?? 'the record'}`,
    errorTitle: 'Couldn’t link that record',
  });

  const linked = (record: ResolvedTargetDTO) =>
    existing.some((link) => link.targetType === record.type && link.targetId === record.id);

  const submit = async () => {
    if (!picked) return;
    const link = await add.run({
      ...('taskId' in owner ? { taskId: owner.taskId } : { projectId: owner.projectId }),
      targetType: picked.type,
      targetId: picked.id,
    });
    if (link) {
      onLinked?.(link);
      onOpenChange(false);
    }
  };

  return (
    <>
      <DialogHeader
        icon={
          <span className="flex size-9 items-center justify-center rounded-lg bg-sunken">
            <Link2 aria-hidden className="size-4 text-icon" />
          </span>
        }
        title="Link a record"
        description="Connect a deal, customer or warehouse record."
      />
      <DialogBody className="flex flex-col gap-3 pb-4">
        {status.isPending ? (
          <div className="flex justify-center py-10">
            <Spinner label="Checking connected apps" />
          </div>
        ) : types.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border-default bg-sunken px-4 py-6 text-center text-sm text-fg-secondary">
            No other KitStak apps are connected to this workspace yet. Add CRM or WMS in Portal billing to
            link their records.
          </p>
        ) : (
          <>
            <div role="radiogroup" aria-label="Kind of record" className="flex flex-wrap gap-1.5">
              {types.map((t) => {
                const checked = t === active;
                return (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    onClick={() => {
                      setType(t);
                      setPicked(null);
                    }}
                    className={cn(
                      'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors',
                      'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
                      checked
                        ? 'border-primary bg-primary-subtle text-primary-text'
                        : 'border-border-default bg-panel text-fg-secondary hover:border-border-strong hover:text-fg',
                    )}
                  >
                    <SiblingAppMark app={targetApp(t)} size={12} />
                    {SHORT[t]}
                  </button>
                );
              })}
            </div>
            {active ? (
              <Command
                shouldFilter={false}
                loop
                className="overflow-hidden rounded-lg border border-border-default bg-panel"
              >
                <div className="flex items-center gap-2 border-b border-border-subtle px-3">
                  <Search aria-hidden className="size-4 shrink-0 text-icon" />
                  <Command.Input
                    autoFocus
                    value={query}
                    onValueChange={setQuery}
                    placeholder={HINT[active]}
                    aria-label={HINT[active]}
                    className="h-10 min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-placeholder"
                  />
                  {results.isFetching ? <Spinner size="sm" label={null} /> : null}
                </div>
                <Command.List className="max-h-72 overflow-y-auto p-1">
                  {!results.isFetching && (results.data ?? []).length === 0 ? (
                    <p className="px-3 py-8 text-center text-sm text-fg-muted">
                      {debounced
                        ? `Nothing matches “${debounced}”.`
                        : `No ${SHORT[active].toLowerCase()} yet.`}
                    </p>
                  ) : null}
                  {(results.data ?? []).map((record) => {
                    const already = linked(record);
                    const selected = picked?.id === record.id && picked.type === record.type;
                    return (
                      <Command.Item
                        key={`${record.type}:${record.id}`}
                        value={`${record.type}:${record.id}`}
                        disabled={already}
                        onSelect={() => setPicked(record)}
                        className={cn('ks-menu-item', selected && 'bg-selected', already && 'opacity-60')}
                      >
                        <SiblingAppMark app={targetApp(record.type)} size={14} className="shrink-0" />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate">{record.title}</span>
                          {already ? <span className="text-2xs text-fg-muted">Already linked</span> : null}
                        </span>
                        <RecordStatus status={record.status} />
                        {selected ? (
                          <Check aria-hidden className="size-4 shrink-0 text-primary-text" />
                        ) : null}
                      </Command.Item>
                    );
                  })}
                </Command.List>
              </Command>
            ) : null}
          </>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          onClick={submit}
          disabled={!picked}
          loading={add.pending}
          leadingIcon={<Link2 aria-hidden />}
          data-testid="link-record-submit"
        >
          Link record
        </Button>
      </DialogFooter>
    </>
  );
}

/** Program, build and project links through `core.record_links` (Program, Build, WMS shipment order and related Pulse job tabs). */
export { RecordLinkDialog, type RecordLinkDialogProps, type RecordLinkKind } from './record-link-dialog';
