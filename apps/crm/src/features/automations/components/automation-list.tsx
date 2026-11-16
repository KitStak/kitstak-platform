'use client';
/**
 * Board automations list: sentence summary, creator, created / last run, run stats, on/off
 * toggle (optimistic + toast), and a menu with Edit, Duplicate, Test with item, Run history and
 * Delete (deferred delete with Undo).
 */
import { useMemo, useState } from 'react';
import {
  CircleAlert,
  Copy,
  FlaskConical,
  History,
  MoreHorizontal,
  Pencil,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react';
import {
  Avatar,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  SearchInput,
  Tooltip,
  cn,
} from '@/components/ui';
import { useAutomationToggle, useEnabledOverrides } from '../hooks/use-automation-toggle';
import type { AutomationDto } from '@/server/services/contracts/dto';
import { draftFromAutomation, draftParts, partsToText } from '../model/draft';
import { createResolver, type BuilderContext } from '../model/resolver';
import { formatDateTime, relativeTime } from './format';
import { SentenceText } from './sentence';
import { Switch } from './switch';
import { TestAutomationDialog } from './test-automation-dialog';

export interface AutomationListProps {
  readonly automations: readonly AutomationDto[];
  readonly context: BuilderContext;
  readonly canEdit: boolean;
  readonly onEdit: (automation: AutomationDto) => void;
  readonly onDuplicate: (automation: AutomationDto) => void;
  readonly onViewRuns: (automation: AutomationDto) => void;
  readonly onBrowse: () => void;
  readonly onCustom: () => void;
  /** Ids hidden while a deferred delete is pending (shared with the tab count). */
  readonly pendingDeletes: ReadonlySet<string>;
  /** Deferred delete with Undo (owned by the center so tab switches don't cancel it). */
  readonly onDelete: (automation: AutomationDto) => void;
}

const SEPARATED =
  "relative before:pointer-events-none before:absolute before:top-1/2 before:-left-3 before:-translate-y-1/2 before:text-fg-muted before:content-['·']";

export function AutomationList({
  automations,
  context,
  canEdit,
  onEdit,
  onDuplicate,
  onViewRuns,
  onBrowse,
  onCustom,
  pendingDeletes,
  onDelete,
}: AutomationListProps) {
  const resolver = useMemo(() => createResolver(context), [context]);
  const [query, setQuery] = useState('');
  const [testing, setTesting] = useState<AutomationDto | null>(null);
  const userById = useMemo(() => new Map(context.users.map((user) => [user.id, user])), [context.users]);
  const rows = useMemo(
    () =>
      automations
        .filter((automation) => !pendingDeletes.has(automation.id))
        .map((automation) => {
          const parts = draftParts(draftFromAutomation(automation), resolver);
          return { automation, parts, text: partsToText(parts, context.term) };
        }),
    [automations, pendingDeletes, resolver, context.term],
  );
  const q = query.trim().toLowerCase();
  const visible = q
    ? rows.filter((row) => `${row.automation.name} ${row.text}`.toLowerCase().includes(q))
    : rows;

  const toggle = useAutomationToggle();
  const overrides = useEnabledOverrides();

  if (rows.length === 0) {
    return (
      <EmptyState
        illustration="board"
        title="No automations yet"
        actions={
          <>
            <Button onClick={onBrowse}>Browse recipes</Button>
            <Button
              variant="secondary"
              leadingIcon={<Wand2 aria-hidden />}
              onClick={onCustom}
              disabled={!canEdit}
            >
              Create automation
            </Button>
          </>
        }
      />
    );
  }

  const active = rows.filter((row) => overrides.get(row.automation.id) ?? row.automation.enabled).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          value={query}
          onValueChange={setQuery}
          placeholder="Search automations"
          aria-label="Search automations"
          containerClassName="w-full sm:w-72"
        />
        <p className="text-sm text-fg-secondary">
          {active} of {rows.length} active
        </p>
        <Button className="sm:ml-auto" leadingIcon={<Sparkles aria-hidden />} onClick={onBrowse} variant="ghost">
          Browse recipes
        </Button>
      </div>
      {visible.length === 0 ? (
        <EmptyState
          illustration="search"
          size="sm"
          title="No automations match"
          description={`Nothing matches “${query}”.`}
          actions={
            <Button variant="secondary" onClick={() => setQuery('')}>
              Clear search
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Board automations" data-testid="automation-list">
          {visible.map(({ automation: stored, parts }) => {
            const override = overrides.get(stored.id);
            const automation = override === undefined ? stored : { ...stored, enabled: override };
            const creator = automation.createdBy ? userById.get(automation.createdBy) : undefined;
            const failing = automation.failureCount > 0 && automation.runCount > 0;
            return (
              <li
                key={automation.id}
                data-testid="automation-row"
                data-automation-id={automation.id}
                data-enabled={automation.enabled}
                className="group flex flex-col gap-3 rounded-lg border border-border-subtle bg-panel px-4 py-3.5 shadow-xs transition-[border-color,box-shadow] duration-[var(--duration-fast)] hover:border-border-strong hover:shadow-sm sm:flex-row sm:items-center sm:gap-4"
              >
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <Switch
                    checked={automation.enabled}
                    onCheckedChange={(enabled) => toggle(automation, enabled)}
                    label={`${automation.enabled ? 'Turn off' : 'Turn on'} ${automation.name}`}
                    disabled={!canEdit}
                    className="mt-0.5"
                    data-testid="automation-toggle"
                  />
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => (canEdit ? onEdit(automation) : onViewRuns(automation))}
                      className="group/title block w-full rounded-xs text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                    >
                      <span
                        className="block truncate text-md font-semibold text-fg transition-colors duration-[var(--duration-fast)] group-hover/title:text-primary-text"
                        data-testid="automation-row-name"
                      >
                        {automation.name}
                      </span>
                      <span
                        className={cn(
                          'mt-0.5 block text-sm leading-6 text-fg-secondary',
                          !automation.enabled && 'opacity-80',
                        )}
                      >
                        <SentenceText parts={parts} term={context.term} />
                      </span>
                    </button>
                    {/* Separators are ::before dots in the gap; overflow-x-clip hides the one at each line start, so a wrap never leaves a dangling "·". */}
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-5 gap-y-1 overflow-x-clip text-xs text-fg-secondary">
                      <span className="inline-flex items-center gap-1.5">
                        {creator ? (
                          <Avatar
                            name={creator.name}
                            src={creator.image}
                            size="xs"
                            colorKey={creator.id}
                            showTooltip
                          />
                        ) : null}
                        <span title={formatDateTime(automation.createdAt)}>
                          Created {relativeTime(automation.createdAt)}
                        </span>
                      </span>
                      <span
                        className={SEPARATED}
                        title={automation.lastRunAt ? formatDateTime(automation.lastRunAt) : undefined}>
                        {automation.lastRunAt
                          ? `Last ran ${relativeTime(automation.lastRunAt)}`
                          : 'Never ran'}
                      </span>
                      <span className={cn(SEPARATED, 'tabular-nums')}>
                        {automation.runCount.toLocaleString()} {automation.runCount === 1 ? 'run' : 'runs'}
                      </span>
                      {failing ? (
                        <Tooltip content="See the failed runs in Run history">
                          <button
                            type="button"
                            onClick={() => onViewRuns(automation)}
                            className="rounded-xs focus-visible:outline-2 focus-visible:outline-focus"
                          >
                            <Badge tone="danger" size="sm" icon={<CircleAlert aria-hidden />}>
                              {automation.failureCount} failed
                            </Badge>
                          </button>
                        </Tooltip>
                      ) : null}
                      {!automation.enabled ? (
                        <Badge tone="neutral" size="sm">
                          Off
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 self-end sm:self-center">
                  {canEdit ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      leadingIcon={<Pencil aria-hidden />}
                      onClick={() => onEdit(automation)}
                    >
                      Edit
                    </Button>
                  ) : null}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <IconButton
                        label={`More actions for ${automation.name}`}
                        icon={<MoreHorizontal aria-hidden />}
                        size="sm"
                      />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuItem
                        icon={<Pencil />}
                        disabled={!canEdit}
                        onSelect={() => onEdit(automation)}
                      >
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        icon={<Copy />}
                        disabled={!canEdit}
                        onSelect={() => onDuplicate(automation)}
                      >
                        Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        icon={<FlaskConical />}
                        disabled={!canEdit}
                        onSelect={() => setTesting(automation)}
                      >
                        Test with an item…
                      </DropdownMenuItem>
                      <DropdownMenuItem icon={<History />} onSelect={() => onViewRuns(automation)}>
                        Run history
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        icon={<Trash2 />}
                        variant="danger"
                        disabled={!canEdit}
                        onSelect={() => onDelete(automation)}
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <TestAutomationDialog automation={testing} context={context} onClose={() => setTesting(null)} />
    </div>
  );
}
