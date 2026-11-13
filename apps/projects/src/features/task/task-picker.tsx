'use client';
/**
 * Searchable task list (dependencies, "make it a subtask of…"). Shows this project's open tasks
 * first; typing searches by key or words across every project you can see (unless
 * `sameProjectOnly`). Arrow keys + Enter pick.
 */
import { useMemo, useState } from 'react';
import { Command } from 'cmdk';
import { Search } from 'lucide-react';
import { Spinner } from '@/components/ui';
import { StatusIcon } from '@/components/pm';
import { compareRank } from '@/lib/rank';
import { useDebouncedValue } from '@/lib/hooks/use-debounced-value';
import { useProjectTasks, useSearch } from '@/lib/hooks/use-data';
import type { TaskRef } from '@/lib/types';

export interface TaskPickerProps {
  readonly projectKey: string;
  readonly exclude: ReadonlySet<string>;
  readonly onPick: (task: TaskRef) => void;
  readonly sameProjectOnly?: boolean;
  readonly placeholder?: string;
  /** Hide subtasks from the default list (they can still be searched). */
  readonly topLevelOnly?: boolean;
}

export function TaskPickerList({
  projectKey,
  exclude,
  onPick,
  sameProjectOnly = false,
  placeholder = 'Search tasks by name or key…',
  topLevelOnly = false,
}: TaskPickerProps) {
  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query.trim(), 200);
  const projectTasks = useProjectTasks(projectKey);
  const search = useSearch(sameProjectOnly ? '' : debounced, {
    enabled: !sameProjectOnly && debounced.length > 0,
  });

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const local = (projectTasks.data ?? [])
      .filter((task) => !exclude.has(task.id))
      .filter((task) => (topLevelOnly && !q ? !task.parentTaskId : true))
      .filter((task) => !q || task.title.toLowerCase().includes(q) || task.key.toLowerCase().includes(q))
      .sort((a, b) => {
        const aDone = a.statusCategory === 'done' || a.statusCategory === 'cancelled' ? 1 : 0;
        const bDone = b.statusCategory === 'done' || b.statusCategory === 'cancelled' ? 1 : 0;
        return aDone - bDone || compareRank(a.position, b.position);
      });
    const seen = new Set(local.map((task) => task.id));
    const remote =
      !sameProjectOnly && q
        ? (search.data?.tasks ?? []).filter((task) => !exclude.has(task.id) && !seen.has(task.id))
        : [];
    return { local: local.slice(0, 50), remote: remote.slice(0, 20) };
  }, [exclude, projectTasks.data, query, sameProjectOnly, search.data?.tasks, topLevelOnly]);

  const loading =
    projectTasks.isLoading ||
    (search.isFetching && results.remote.length === 0 && debounced.length > 0 && !sameProjectOnly);

  const row = (task: TaskRef, projectName?: string) => (
    <Command.Item key={task.id} value={task.id} onSelect={() => onPick(task)} className="ks-menu-item">
      <StatusIcon category={task.statusCategory} />
      <span className="shrink-0 font-mono text-2xs text-fg-muted">{task.key}</span>
      <span
        className={
          task.statusCategory === 'done'
            ? 'min-w-0 flex-1 truncate text-fg-muted line-through'
            : 'min-w-0 flex-1 truncate'
        }
      >
        {task.title}
      </span>
      {projectName ? (
        <span className="max-w-24 shrink-0 truncate text-2xs text-fg-muted">{projectName}</span>
      ) : null}
    </Command.Item>
  );

  return (
    <Command
      shouldFilter={false}
      loop
      className="flex max-h-[360px] flex-col"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-center gap-2 border-b border-border-subtle px-3">
        <Search aria-hidden className="size-4 shrink-0 text-icon" />
        <Command.Input
          autoFocus
          value={query}
          onValueChange={setQuery}
          placeholder={placeholder}
          className="h-10 min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-placeholder"
        />
        {loading ? <Spinner size="xs" label={null} /> : null}
      </div>
      <Command.List className="min-h-0 flex-1 overflow-y-auto p-1">
        {!loading && results.local.length === 0 && results.remote.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-fg-muted">
            {query ? 'No tasks match that.' : 'No other tasks here yet.'}
          </div>
        ) : null}
        {results.local.length ? (
          <Command.Group
            heading={
              <span className="px-2 text-2xs font-semibold tracking-wide text-fg-muted uppercase">
                This project
              </span>
            }
          >
            {results.local.map((task) => row(task))}
          </Command.Group>
        ) : null}
        {results.remote.length ? (
          <Command.Group
            heading={
              <span className="px-2 text-2xs font-semibold tracking-wide text-fg-muted uppercase">
                Other projects
              </span>
            }
          >
            {results.remote.map((task) => row(task, task.projectName))}
          </Command.Group>
        ) : null}
      </Command.List>
    </Command>
  );
}
