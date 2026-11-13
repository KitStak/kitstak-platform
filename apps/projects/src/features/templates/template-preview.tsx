'use client';
/**
 * Template preview (right sheet): what you get before you use it. Workflow steps, sections with
 * their tasks and "day N" dates, milestones, labels, custom fields and the automations that come
 * with it, written as plain sentences.
 */
import { describeTemplateTaskCounts } from '@/lib/template-math';
import Link from 'next/link';
import { ArrowRight, CalendarRange, Diamond, Flag, ListChecks, Tag, Workflow, Zap } from 'lucide-react';
import { Badge, SheetContent, buttonVariants, cn, labelColorStyle, toLabelColor } from '@/components/ui';
import { EntityIcon, StatusIcon } from '@/components/pm';
import { describeAutomation } from '@/server/automations/engine';
import { CUSTOM_FIELD_TYPE_LABELS } from '@/lib/constants';
import { routes } from '@/lib/routes';
import type { TemplatePayload, TemplateTask } from '@/lib/template-types';
import type { TemplateDTO } from '@/lib/types';

function dayText(offset: number | undefined): string | null {
  if (offset === undefined) return null;
  if (offset <= 0) return 'Day 1';
  return `Day ${offset + 1}`;
}

function weeks(days: number | undefined): string | null {
  if (!days) return null;
  if (days < 14) return `${days} days`;
  return `${Math.round(days / 7)} weeks`;
}

function Section({
  icon,
  title,
  count,
  children,
}: {
  readonly icon: React.ReactNode;
  readonly title: string;
  readonly count?: number;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="border-b border-border-subtle px-6 py-4 last:border-b-0">
      <h3 className="mb-2.5 flex items-center gap-2 text-sm font-semibold text-fg">
        <span className="text-icon [&_svg]:size-4">{icon}</span>
        {title}
        {count !== undefined ? (
          <span className="rounded-full bg-muted px-1.5 text-xs font-semibold text-fg-secondary">
            {count}
          </span>
        ) : null}
      </h3>
      {children}
    </section>
  );
}

function TaskLine({ task, depth = 0 }: { readonly task: TemplateTask; readonly depth?: number }) {
  const day = dayText(task.dueOffsetDays);
  return (
    <>
      <li className="flex items-center gap-2 py-1 text-sm" style={{ paddingLeft: depth * 20 }}>
        {task.isMilestone ? (
          <Diamond aria-hidden className="size-3.5 shrink-0 text-primary-text" />
        ) : (
          <span
            aria-hidden
            className="size-3.5 shrink-0 rounded-full border-[1.5px] border-dashed border-border-strong"
          />
        )}
        <span className={cn('min-w-0 flex-1 truncate', depth > 0 ? 'text-fg-secondary' : 'text-fg')}>
          {task.title}
        </span>
        {task.priority === 'urgent' || task.priority === 'high' ? (
          <Badge size="sm" tone={task.priority === 'urgent' ? 'danger' : 'warning'}>
            {task.priority === 'urgent' ? 'Urgent' : 'High'}
          </Badge>
        ) : null}
        {day ? <span className="shrink-0 text-xs text-fg-muted tabular-nums">{day}</span> : null}
      </li>
      {task.subtasks?.map((sub, index) => (
        <TaskLine key={`${sub.title}-${index}`} task={sub} depth={depth + 1} />
      ))}
    </>
  );
}

function templateLookups(payload: TemplatePayload) {
  const status = new Map(payload.statuses.map((s) => [s.key, s.name]));
  const label = new Map((payload.labels ?? []).map((l) => [l.key, l.name]));
  const section = new Map((payload.sections ?? []).map((s) => [s.key, s.name]));
  return {
    status: (id: string) => status.get(id),
    label: (id: string) => label.get(id),
    section: (id: string) => section.get(id),
  };
}

export function TemplatePreview({
  template,
  canUse,
}: {
  readonly template: TemplateDTO;
  readonly canUse: boolean;
}) {
  const payload = template.payload;
  const tasks = payload.tasks ?? [];
  const sections = payload.sections ?? [];
  const lookups = templateLookups(payload);
  const grouped = sections.length
    ? [
        ...sections.map((section) => ({
          key: section.key,
          name: section.name,
          tasks: tasks.filter((task) => task.sectionKey === section.key),
        })),
        {
          key: '__none',
          name: 'Other tasks',
          tasks: tasks.filter((task) => !task.sectionKey || !sections.some((s) => s.key === task.sectionKey)),
        },
      ].filter((group) => group.tasks.length > 0)
    : [{ key: '__all', name: '', tasks }];
  const automations = payload.automations ?? [];
  return (
    <SheetContent
      width={640}
      title={
        <span className="flex items-center gap-3">
          <EntityIcon icon={template.icon} color={template.color} size={32} />
          <span className="truncate">{template.name}</span>
        </span>
      }
      description={template.description ?? undefined}
      data-testid="template-preview"
      onOpenAutoFocus={(event) => {
        // Focus the panel itself (not the close button, whose tooltip would cover the description).
        event.preventDefault();
        (event.currentTarget as HTMLElement | null)?.focus();
      }}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-6 py-3">
        <Badge>{template.category}</Badge>
        <Badge tone={template.builtIn ? 'neutral' : 'primary'}>
          {template.builtIn ? 'Built in' : 'Your team'}
        </Badge>
        {weeks(payload.durationDays) ? (
          <Badge icon={<CalendarRange aria-hidden />}>About {weeks(payload.durationDays)}</Badge>
        ) : null}
        <Badge icon={<ListChecks aria-hidden />}>{describeTemplateTaskCounts({ tasks: template.taskCount, subtasks: template.subtaskCount ?? 0 })}</Badge>
        {automations.length ? (
          <Badge icon={<Zap aria-hidden />} tone="warning">
            {automations.length} {automations.length === 1 ? 'automation' : 'automations'}
          </Badge>
        ) : null}
        {payload.asksForCustomer ? <Badge tone="info">Asks which client it’s for</Badge> : null}
        {!template.builtIn && template.useCount > 0 ? (
          <span className="text-xs text-fg-muted">
            Used {template.useCount} {template.useCount === 1 ? 'time' : 'times'}
          </span>
        ) : null}
      </div>

      <Section
        icon={<Workflow aria-hidden />}
        title="Steps every task moves through"
        count={payload.statuses.length}
      >
        <ol className="flex flex-wrap items-center gap-1.5">
          {payload.statuses.map((status, index) => (
            <li key={status.key} className="flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-panel px-2.5 py-1 text-xs font-medium text-fg">
                <StatusIcon category={status.category} color={status.color} size={12} />
                {status.name}
                {status.wipLimit ? <span className="text-fg-muted">· max {status.wipLimit}</span> : null}
              </span>
              {index < payload.statuses.length - 1 ? (
                <ArrowRight aria-hidden className="size-3 text-icon" />
              ) : null}
            </li>
          ))}
        </ol>
      </Section>

      {tasks.length ? (
        <Section icon={<ListChecks aria-hidden />} title={template.subtaskCount ? `Tasks (+ ${template.subtaskCount} subtasks)` : 'Tasks'} count={template.taskCount}>
          <div className="flex flex-col gap-3">
            {grouped.map((group) => (
              <div key={group.key}>
                {group.name ? (
                  <p className="mb-1 text-xs font-semibold tracking-wide text-fg-muted uppercase">
                    {group.name}
                  </p>
                ) : null}
                <ul>
                  {group.tasks.map((task, index) => (
                    <TaskLine key={`${task.title}-${index}`} task={task} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {payload.milestones?.length ? (
        <Section icon={<Flag aria-hidden />} title="Milestones" count={payload.milestones.length}>
          <ul className="flex flex-col gap-1">
            {payload.milestones.map((milestone) => (
              <li key={milestone.key} className="flex items-center gap-2 text-sm text-fg">
                <Diamond aria-hidden className="size-3.5 text-primary-text" />
                <span className="flex-1">{milestone.name}</span>
                {dayText(milestone.dueOffsetDays) ? (
                  <span className="text-xs text-fg-muted tabular-nums">
                    {dayText(milestone.dueOffsetDays)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {automations.length ? (
        <Section icon={<Zap aria-hidden />} title="Automations included" count={automations.length}>
          <ul className="flex flex-col gap-2">
            {automations.map((rule, index) => (
              <li key={`${rule.name}-${index}`} className="rounded-lg bg-sunken px-3 py-2">
                <p className="text-sm font-medium text-fg">{rule.name}</p>
                <p className="text-xs text-fg-secondary">
                  {describeAutomation(
                    { trigger: rule.trigger, conditions: rule.conditions ?? [], actions: rule.actions },
                    lookups,
                  )}
                </p>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {payload.labels?.length || payload.customFields?.length ? (
        <Section icon={<Tag aria-hidden />} title="Labels and fields">
          <div className="flex flex-wrap gap-1.5">
            {(payload.labels ?? []).map((label) => (
              <span
                key={label.key}
                style={labelColorStyle(toLabelColor(label.color))}
                className="inline-flex items-center gap-1.5 rounded-full bg-[var(--lc-subtle)] px-2 py-0.5 text-xs font-medium text-fg"
              >
                <span aria-hidden className="size-2 rounded-full bg-[var(--lc-bg)]" />
                {label.name}
              </span>
            ))}
            {(payload.customFields ?? []).map((field) => (
              <span
                key={field.key}
                className="inline-flex items-center gap-1 rounded-full border border-border-subtle px-2 py-0.5 text-xs text-fg-secondary"
              >
                {field.name}{' '}
                <span className="text-fg-muted">· {CUSTOM_FIELD_TYPE_LABELS[field.type] ?? field.type}</span>
              </span>
            ))}
          </div>
        </Section>
      ) : null}

      {canUse ? (
        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border-subtle bg-raised px-6 py-3">
          <Link
            href={routes.newProject({ template: template.id })}
            className={buttonVariants({ variant: 'primary', size: 'md' })}
            data-testid="template-use"
          >
            Use this template <ArrowRight aria-hidden className="size-4" />
          </Link>
        </div>
      ) : null}
    </SheetContent>
  );
}
