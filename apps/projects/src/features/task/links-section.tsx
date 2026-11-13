'use client';
/**
 * Linked records from the sibling apps: CRM deals / accounts / customers and WMS orders, work
 * orders, receipts and counts. Shows the cached title + live status with a link into the other
 * app, refreshes on demand, and links new records with a search picker. Hidden entirely when no
 * sibling app is available and nothing is linked (Projects works on its own).
 */
import { useState } from 'react';
import { Command } from 'cmdk';
import { ExternalLink, Link2, Plus, RefreshCw, Search, X } from 'lucide-react';
import {
  Button,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Spinner,
  Tooltip,
  cn,
  toast,
} from '@/components/ui';
import { INTEGRATION_TARGET_LABELS, type IntegrationTargetType } from '@/lib/constants';
import { formatRelative } from '@/lib/dates';
import { useDebouncedValue } from '@/lib/hooks/use-debounced-value';
import { useIntegrationSearch, useIntegrationStatus } from '@/lib/hooks/use-data';
import type { IntegrationLinkDTO } from '@/lib/types';
import { addLinkAction, refreshLinksAction, removeLinkAction } from '@/server/actions/links';
import { SectionHeading } from './property-row';
import { useTaskContext } from './task-context';
import { LocalTime } from './local-time';

const CRM_TYPES: ReadonlySet<IntegrationTargetType> = new Set(['crm_item', 'crm_account', 'core_customer']);

function AppBadge({ type }: { readonly type: IntegrationTargetType }) {
  const crm = CRM_TYPES.has(type);
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-md text-2xs font-bold tracking-wide',
        crm
          ? 'bg-[color-mix(in_srgb,var(--label-blue)_14%,transparent)] text-[var(--label-blue-text)]'
          : 'bg-[color-mix(in_srgb,var(--label-teal)_16%,transparent)] text-[var(--label-teal-text)]',
      )}
    >
      {crm ? 'CRM' : 'WMS'}
    </span>
  );
}

function LinkRow({
  link,
  onRemove,
  canEdit,
}: {
  readonly link: IntegrationLinkDTO;
  readonly onRemove: () => void;
  readonly canEdit: boolean;
}) {
  const kind = INTEGRATION_TARGET_LABELS[link.targetType];
  const title = link.title ?? `${kind} ${link.targetId.slice(0, 8)}`;
  const body = (
    <>
      <AppBadge type={link.targetType} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-fg">{title}</span>
        <span className="flex items-center gap-1.5 truncate text-2xs text-fg-muted">
          {kind}
          {link.cachedAt ? (
            <LocalTime iso={link.cachedAt}>· checked {formatRelative(link.cachedAt)}</LocalTime>
          ) : null}
        </span>
      </span>
      {link.status ? (
        <span className="max-w-32 shrink-0 truncate rounded-full bg-muted px-2 py-0.5 text-2xs font-medium text-fg-secondary">
          {link.status}
        </span>
      ) : null}
      {link.url ? <ExternalLink aria-hidden className="size-3.5 shrink-0 text-icon" /> : null}
    </>
  );
  return (
    <li className="group/link flex items-center gap-1 rounded-md hover:bg-hover" data-testid="task-link-row">
      {link.url ? (
        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md p-1.5 focus-visible:outline-2 focus-visible:outline-focus"
          aria-label={`${kind}: ${title}${link.status ? `, ${link.status}` : ''} (opens in a new tab)`}
        >
          {body}
        </a>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-2.5 p-1.5">{body}</span>
      )}
      {canEdit ? (
        <IconButton
          size="sm"
          label={`Unlink ${title}`}
          icon={<X aria-hidden />}
          onClick={onRemove}
          className="mr-1 opacity-0 group-hover/link:opacity-100 focus-visible:opacity-100 max-sm:opacity-100"
        />
      ) : null}
    </li>
  );
}

function LinkPicker({
  types,
  onPick,
  busy,
}: {
  readonly types: readonly IntegrationTargetType[];
  readonly onPick: (type: IntegrationTargetType, id: string, title: string) => void;
  readonly busy: boolean;
}) {
  const [type, setType] = useState<IntegrationTargetType>(types[0]);
  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query.trim(), 200);
  const results = useIntegrationSearch(type, debounced);
  return (
    <div className="flex flex-col">
      <div
        className="flex flex-wrap gap-1 border-b border-border-subtle p-2"
        role="radiogroup"
        aria-label="What to link"
      >
        {types.map((entry) => (
          <button
            key={entry}
            type="button"
            role="radio"
            aria-checked={entry === type}
            onClick={() => setType(entry)}
            className={cn(
              'h-7 rounded-full border px-2.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-focus',
              entry === type
                ? 'border-primary bg-primary-subtle text-primary-text'
                : 'border-border-subtle text-fg-secondary hover:bg-hover',
            )}
          >
            {INTEGRATION_TARGET_LABELS[entry]}
          </button>
        ))}
      </div>
      <Command shouldFilter={false} loop className="flex max-h-[320px] flex-col">
        <div className="flex items-center gap-2 border-b border-border-subtle px-3">
          <Search aria-hidden className="size-4 shrink-0 text-icon" />
          <Command.Input
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder={`Search ${INTEGRATION_TARGET_LABELS[type].toLowerCase()}s…`}
            className="h-10 min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-placeholder"
          />
          {results.isFetching || busy ? <Spinner size="xs" label={null} /> : null}
        </div>
        <Command.List className="min-h-0 flex-1 overflow-y-auto p-1">
          {!results.isFetching && (results.data ?? []).length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-fg-muted">
              {debounced ? 'Nothing matches that.' : 'Nothing to show yet. Try typing a name or number.'}
            </div>
          ) : null}
          {(results.data ?? []).map((target) => (
            <Command.Item
              key={`${target.type}:${target.id}`}
              value={`${target.type}:${target.id}`}
              onSelect={() => onPick(target.type, target.id, target.title)}
              className="ks-menu-item"
            >
              <AppBadge type={target.type} />
              <span className="min-w-0 flex-1 truncate">{target.title}</span>
              {target.status ? (
                <span className="max-w-28 shrink-0 truncate text-2xs text-fg-muted">{target.status}</span>
              ) : null}
            </Command.Item>
          ))}
        </Command.List>
      </Command>
    </div>
  );
}

export function LinksSection() {
  const { task, canEdit, refresh } = useTaskContext();
  const status = useIntegrationStatus();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const types = status.data?.targetTypes ?? [];
  const links = task.links;

  if (links.length === 0 && types.length === 0) return null;

  const add = async (targetType: IntegrationTargetType, targetId: string, title: string) => {
    if (links.some((link) => link.targetType === targetType && link.targetId === targetId)) {
      toast.info('Already linked', `${title} is already on this task.`);
      return;
    }
    setBusy(true);
    const result = await addLinkAction({ taskId: task.id, targetType, targetId });
    setBusy(false);
    if (!result.ok) {
      toast.error("Couldn't link that record", result.error.message);
      return;
    }
    setOpen(false);
    toast.success(`Linked ${result.data.title ?? title}`);
    refresh();
  };

  const remove = async (link: IntegrationLinkDTO) => {
    const result = await removeLinkAction({ linkId: link.id });
    if (!result.ok) {
      toast.error("Couldn't unlink that record", result.error.message);
      return;
    }
    toast.undo(`Unlinked ${link.title ?? INTEGRATION_TARGET_LABELS[link.targetType]}`, {
      onUndo: async () => {
        const undo = await addLinkAction({
          taskId: task.id,
          targetType: link.targetType,
          targetId: link.targetId,
        });
        if (!undo.ok) throw new Error(undo.error.message);
        refresh();
      },
    });
    refresh();
  };

  const recheck = async () => {
    setRefreshing(true);
    const result = await refreshLinksAction({ taskId: task.id });
    setRefreshing(false);
    if (!result.ok) {
      toast.error("Couldn't refresh the linked records", result.error.message);
      return;
    }
    refresh();
  };

  return (
    <section aria-labelledby="task-links-heading" data-testid="task-links">
      <SectionHeading
        id="task-links-heading"
        icon={<Link2 aria-hidden />}
        count={links.length || undefined}
        actions={
          <>
            {links.length ? (
              <Tooltip content="Get the latest status from CRM and WMS">
                <IconButton
                  size="sm"
                  label="Refresh linked records"
                  icon={<RefreshCw aria-hidden className={refreshing ? 'animate-spin' : undefined} />}
                  onClick={() => void recheck()}
                  disabled={refreshing}
                />
              </Tooltip>
            ) : null}
            {canEdit && types.length ? (
              <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                  <Button size="sm" variant="ghost" leadingIcon={<Plus aria-hidden />}>
                    Link
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  flush
                  align="end"
                  className="w-[min(380px,calc(100vw-24px))]"
                  aria-label="Link a record"
                >
                  <LinkPicker
                    types={types}
                    busy={busy}
                    onPick={(type, id, title) => void add(type, id, title)}
                  />
                </PopoverContent>
              </Popover>
            ) : null}
          </>
        }
      >
        Linked records
      </SectionHeading>
      {links.length ? (
        <ul className="mt-1 flex flex-col gap-0.5">
          {links.map((link) => (
            <LinkRow key={link.id} link={link} canEdit={canEdit} onRemove={() => void remove(link)} />
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-fg-muted">
          Connect a CRM deal, customer or warehouse order so everyone sees the full picture.
        </p>
      )}
    </section>
  );
}
