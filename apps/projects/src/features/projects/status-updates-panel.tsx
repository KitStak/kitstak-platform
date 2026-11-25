'use client';
/**
 * Status updates, shared by projects and programs (docs/programs/SPEC.md 10.2 L3): the health
 * choice, the composer (health, note and an optional stage), one update in the history, and the
 * project Status updates panel. Programs post through `postProgramUpdateAction` with the same
 * composer, so both read and feel the same.
 *
 *   <StatusUpdateComposer initialHealth="on_track" pending={post.pending} onSubmit={({ health, note }) => ...} />
 */
import { useState } from 'react';
import { Megaphone } from 'lucide-react';
import { Button, Select, Skeleton, Textarea, cn } from '@/components/ui';
import { Panel } from '@/components/layout/page';
import { PROJECT_HEALTHS, PROJECT_HEALTH_LABELS, PROJECT_STATUSES, PROJECT_STATUS_LABELS, type ProjectHealth, type ProjectStatus } from '@/lib/constants';
import { useServerAction } from '@/lib/hooks/use-action';
import { useProjectUpdates } from '@/lib/hooks/use-data';
import { usePeopleMap } from '@/lib/hooks/use-people';
import { qk } from '@/lib/query-keys';
import type { ProjectDetail, ProjectUpdateDTO } from '@/lib/types';
import { postProjectUpdateAction } from '@/server/actions/portfolio';
import { LocalTime } from '@/features/task/local-time';
import { HEALTH_HELP, HealthIcon } from './health';

export const HEALTH_COLOR: Readonly<Record<ProjectHealth, string>> = { on_track: 'var(--success)', at_risk: 'var(--warning)', off_track: 'var(--danger)' };

export function HealthChoice({ value, onChange, disabled }: { readonly value: ProjectHealth; readonly onChange: (health: ProjectHealth) => void; readonly disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label="How is it going?" className="grid grid-cols-3 gap-2">
      {PROJECT_HEALTHS.map((health) => {
        const checked = value === health;
        return (
          <button
            key={health}
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={disabled}
            onClick={() => onChange(health)}
            data-testid={`health-${health}`}
            className={cn(
              'flex min-w-0 flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left outline-none max-sm:px-2 transition-[border-color,background-color,box-shadow] duration-[var(--duration-fast)]',
              'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:opacity-50',
              checked ? 'shadow-xs' : 'border-border-subtle bg-panel hover:border-border-default',
            )}
            style={checked ? { borderColor: HEALTH_COLOR[health], background: `color-mix(in srgb, ${HEALTH_COLOR[health]} 9%, var(--surface-panel))` } : undefined}
          >
            <span className="flex items-center gap-1.5 text-sm font-semibold whitespace-nowrap max-sm:gap-1" style={{ color: checked ? HEALTH_COLOR[health] : undefined }}>
              <HealthIcon health={health} className="size-4 shrink-0" />
              {PROJECT_HEALTH_LABELS[health]}
            </span>
            <span className="hidden truncate text-2xs text-fg-muted sm:block">{HEALTH_HELP[health]}</span>
          </button>
        );
      })}
    </div>
  );
}

export function UpdateItem({ update, latest }: { readonly update: ProjectUpdateDTO; readonly latest?: boolean }) {
  const people = usePeopleMap();
  const author = update.authorId ? (people.get(update.authorId)?.name ?? 'Former member') : 'Automation';
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0" data-testid="project-update">
      <span aria-hidden className="absolute top-7 bottom-0 left-[11px] w-px bg-border-subtle group-last/updates:hidden" />
      <span className="relative z-[1] mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-white" style={{ background: HEALTH_COLOR[update.health] }}>
        <HealthIcon health={update.health} className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-fg-secondary">
          <span className="font-semibold text-fg">{author}</span> marked it <span className="font-medium" style={{ color: HEALTH_COLOR[update.health] }}>{PROJECT_HEALTH_LABELS[update.health].toLowerCase()}</span>
          {update.status ? <> and moved it to <span className="font-medium text-fg">{PROJECT_STATUS_LABELS[update.status]}</span></> : null}
          <span className="text-fg-muted"> · {update.progress}% done at the time · </span>
          <LocalTime iso={update.createdAt} className="text-fg-muted" />
          {latest ? <span className="ml-1.5 rounded-sm bg-primary-subtle px-1.5 py-px text-2xs font-semibold text-primary-text">Latest</span> : null}
        </p>
        {update.note ? <p className="mt-1 text-sm whitespace-pre-wrap text-fg">{update.note}</p> : null}
      </div>
    </li>
  );
}

export interface StatusUpdateComposerProps {
  readonly initialHealth: ProjectHealth;
  /** Show the stage select (projects). Programs change their status from the program menu. */
  readonly stage?: { readonly value: ProjectStatus; readonly options?: readonly ProjectStatus[] } | null;
  readonly initialNote?: string;
  readonly pending?: boolean;
  readonly submitLabel?: string;
  readonly helper?: string;
  readonly notePlaceholder?: string;
  /** Resolve true to clear the note after a successful post. */
  readonly onSubmit: (input: { readonly health: ProjectHealth; readonly note: string; readonly status: ProjectStatus | null }) => Promise<boolean> | boolean;
  readonly onCancel?: () => void;
  readonly autoFocus?: boolean;
}

/** Health, note and an optional stage. The submit button turns on once something changed. */
export function StatusUpdateComposer({ initialHealth, stage, initialNote = '', pending, submitLabel = 'Post update', helper = 'Members get a note in their inbox.', notePlaceholder = 'What happened since the last update? Anything blocking you? What’s next?', onSubmit, onCancel, autoFocus }: StatusUpdateComposerProps) {
  const [health, setHealth] = useState<ProjectHealth>(initialHealth);
  const [status, setStatus] = useState<ProjectStatus | null>(stage?.value ?? null);
  const [note, setNote] = useState(initialNote);
  const changed = health !== initialHealth || (stage ? status !== stage.value : false) || note.trim().length > 0;
  return (
    <form
      className="flex flex-col gap-3"
      data-testid="status-update-form"
      onSubmit={(event) => {
        event.preventDefault();
        void Promise.resolve(onSubmit({ health, note: note.trim(), status: stage && status !== stage.value ? status : null })).then((ok) => {
          if (ok) setNote('');
        });
      }}
    >
      <HealthChoice value={health} onChange={setHealth} />
      <Textarea autoFocus={autoFocus} value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={2000} placeholder={notePlaceholder} aria-label="Update note" data-testid="status-update-note" />
      <div className="flex flex-wrap items-center gap-2">
        {stage ? (
          <Select
            aria-label="Project stage"
            size="md"
            value={status ?? stage.value}
            onValueChange={(value) => setStatus(value as ProjectStatus)}
            options={(stage.options ?? PROJECT_STATUSES.filter((s) => s !== 'archived')).map((s) => ({ value: s, label: PROJECT_STATUS_LABELS[s] }))}
            className="w-40"
          />
        ) : null}
        <span className="text-xs text-fg-muted">{helper}</span>
        <span className="ml-auto inline-flex items-center gap-2">
          {onCancel ? (
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
          <Button type="submit" loading={pending} disabled={!changed} data-testid="post-update">
            {submitLabel}
          </Button>
        </span>
      </div>
    </form>
  );
}

/** The update history list with "Show all". */
export function UpdateHistory({ updates, loading, emptyText }: { readonly updates: readonly ProjectUpdateDTO[]; readonly loading?: boolean; readonly emptyText: string }) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? updates : updates.slice(0, 3);
  if (loading) return <Skeleton height={56} rounded="md" />;
  if (updates.length === 0) return <p className="text-sm text-fg-muted">{emptyText}</p>;
  return (
    <>
      <ol className="group/updates flex flex-col" aria-label="Update history">
        {shown.map((update, index) => (
          <UpdateItem key={update.id} update={update} latest={index === 0} />
        ))}
      </ol>
      {updates.length > 3 ? (
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Show fewer' : `Show all ${updates.length} updates`}
        </Button>
      ) : null}
    </>
  );
}

export function StatusUpdatesPanel({ project, canEdit }: { readonly project: ProjectDetail; readonly canEdit: boolean }) {
  const updates = useProjectUpdates(project.key);
  const post = useServerAction(postProjectUpdateAction, {
    invalidate: [qk.project(project.key), qk.projects()],
    successMessage: 'Update posted. The team will see it in their inbox.',
  });
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Megaphone aria-hidden className="size-4 text-icon" />
          Status updates
        </span>
      }
    >
      {canEdit ? (
        <StatusUpdateComposer
          key={`${project.health}:${project.status}`}
          initialHealth={project.health}
          stage={{ value: project.status }}
          pending={post.pending}
          onSubmit={async ({ health, note, status }) => Boolean(await post.run({ projectId: project.id, health, note: note || null, status: status ?? undefined }))}
        />
      ) : null}
      <div className={cn(canEdit && 'mt-4 border-t border-border-subtle pt-4')}>
        <UpdateHistory updates={updates.data ?? []} loading={updates.isPending} emptyText={project.healthNote ?? 'No updates yet. A short weekly update keeps everyone in the loop without a meeting.'} />
      </div>
    </Panel>
  );
}
