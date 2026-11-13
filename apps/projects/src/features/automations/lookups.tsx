'use client';
/**
 * Names and choices the builder needs: the rule's project (statuses, sections, labels), people,
 * every project the person can edit, and the CRM/WMS connection flags. Also turns a draft into
 * the plain-language sentence with the same engine the server uses.
 */
import { useMemo } from 'react';
import { CircleDashed, CircleUserRound, Folder, Globe2, Tag, UserRound } from 'lucide-react';
import { EntityIcon, PriorityIcon, StatusIcon } from '@/components/pm';
import { Avatar, labelColorStyle, toLabelColor } from '@/components/ui';
import { describeAutomation, type DescribeLookups } from '@/server/automations/engine';
import type { AutomationAction, AutomationCondition, AutomationTrigger } from '@/lib/automation-types';
import { PRIORITIES, PRIORITY_LABELS, STATUS_CATEGORIES, STATUS_CATEGORY_LABELS } from '@/lib/constants';
import { useLabels, usePeople, useProject } from '@/lib/hooks/use-data';
import type { LabelDTO, OrgPerson, ProjectSummary, SectionDTO, StatusDTO } from '@/lib/types';
import type { OptionItem } from '@/features/views/option-list';

export interface BuilderLookups {
  readonly projectId: string | null;
  readonly projects: readonly ProjectSummary[];
  readonly statuses: readonly StatusDTO[];
  readonly sections: readonly SectionDTO[];
  readonly labels: readonly LabelDTO[];
  readonly people: readonly OrgPerson[];
  readonly loading: boolean;
  readonly describe: DescribeLookups;
}

export function useBuilderLookups(
  projectId: string | null,
  projects: readonly ProjectSummary[],
): BuilderLookups {
  const project = projects.find((p) => p.id === projectId);
  const detail = useProject(project?.key ?? '', { enabled: Boolean(project) });
  const people = usePeople();
  const labels = useLabels(projectId ?? null);
  return useMemo(() => {
    const statuses = project ? (detail.data?.statuses ?? []) : [];
    const sections = project ? (detail.data?.sections ?? []) : [];
    const labelList = labels.data ?? [];
    const personList = people.data ?? [];
    const byId = <T extends { id: string; name: string }>(list: readonly T[]) => {
      const map = new Map(list.map((item) => [item.id, item.name]));
      return (id: string) => map.get(id);
    };
    return {
      projectId,
      projects,
      statuses,
      sections,
      labels: labelList,
      people: personList,
      loading: Boolean(project && detail.isLoading) || people.isLoading || labels.isLoading,
      describe: {
        status: byId(statuses),
        section: byId(sections),
        label: byId(labelList),
        person: byId(personList),
        project: byId(projects),
      },
    };
  }, [
    project,
    detail.data,
    detail.isLoading,
    labels.data,
    labels.isLoading,
    people.data,
    people.isLoading,
    projectId,
    projects,
  ]);
}

export function sentenceFor(
  draft: {
    readonly trigger: AutomationTrigger;
    readonly conditions: readonly AutomationCondition[];
    readonly actions: readonly AutomationAction[];
  },
  lookups: DescribeLookups,
): string {
  return describeAutomation(draft, lookups);
}

// --- Option lists -----------------------------------------------------------------------------

const iconClass = 'size-4 shrink-0 text-icon';

export function statusOptions(lookups: BuilderLookups): OptionItem[] {
  return lookups.statuses.map((status) => ({
    value: status.id,
    label: status.name,
    icon: <StatusIcon category={status.category} color={status.color} size={14} />,
  }));
}

export function categoryOptions(): OptionItem[] {
  return STATUS_CATEGORIES.map((category) => ({
    value: `category:${category}`,
    label: `any “${STATUS_CATEGORY_LABELS[category]}” status`,
    icon: <StatusIcon category={category} size={14} />,
  }));
}

export function plainCategoryOptions(): OptionItem[] {
  return STATUS_CATEGORIES.map((category) => ({
    value: category,
    label: STATUS_CATEGORY_LABELS[category].toLowerCase(),
    icon: <StatusIcon category={category} size={14} />,
  }));
}

export function sectionOptions(lookups: BuilderLookups): OptionItem[] {
  return lookups.sections.map((section) => ({
    value: section.id,
    label: section.name,
    icon: <Folder aria-hidden className={iconClass} />,
  }));
}

export function labelOptions(lookups: BuilderLookups): OptionItem[] {
  return lookups.labels.map((label) => ({
    value: label.id,
    label: label.name,
    hint: label.projectId ? undefined : 'Workspace',
    icon: (
      <span
        aria-hidden
        className="size-2.5 shrink-0 rounded-full bg-[var(--lc-bg)]"
        style={labelColorStyle(toLabelColor(label.color))}
      />
    ),
  }));
}

export function priorityOptions(): OptionItem[] {
  return PRIORITIES.map((priority) => ({
    value: priority,
    label: PRIORITY_LABELS[priority].toLowerCase(),
    icon: <PriorityIcon priority={priority} size={14} />,
  }));
}

export function personOptions(lookups: BuilderLookups): OptionItem[] {
  return lookups.people.map((person) => ({
    value: person.id,
    label: person.name,
    keywords: person.email,
    icon: <Avatar name={person.name} src={person.image} size="xs" />,
  }));
}

export function projectOptions(
  lookups: BuilderLookups,
  options: { readonly exclude?: string | null; readonly editableOnly?: boolean } = {},
): OptionItem[] {
  return lookups.projects
    .filter((project) => project.id !== options.exclude && !project.archivedAt)
    .filter((project) => !options.editableOnly || project.role === 'owner' || project.role === 'editor')
    .map((project) => ({
      value: project.id,
      label: project.name,
      keywords: project.key,
      hint: project.key,
      icon: <EntityIcon icon={project.icon} color={project.color} size={16} />,
    }));
}

export const PERSON_TARGET_OPTIONS: readonly OptionItem[] = [
  { value: 'assignee', label: 'the assignee', icon: <CircleUserRound aria-hidden className={iconClass} /> },
  {
    value: 'reporter',
    label: 'the person who created it',
    icon: <UserRound aria-hidden className={iconClass} />,
  },
  { value: 'project_owner', label: 'the project owner', icon: <Globe2 aria-hidden className={iconClass} /> },
  { value: 'watchers', label: 'everyone following it', icon: <Tag aria-hidden className={iconClass} /> },
  {
    value: 'actor',
    label: 'the person who made the change',
    icon: <CircleDashed aria-hidden className={iconClass} />,
  },
];

export function dayOptions(values: readonly number[], words: (days: number) => string): OptionItem[] {
  return values.map((days) => ({ value: String(days), label: words(days) }));
}
