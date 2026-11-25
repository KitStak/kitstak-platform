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
import { usePrograms, useVariants } from '@/lib/hooks/use-programs';
import type { ProgramListItemDTO, VariantDTO } from '@/lib/program-types';
import { buildWords, clockText } from './catalog';
import type { LabelDTO, OrgPerson, ProjectSummary, SectionDTO, StatusDTO } from '@/lib/types';
import type { OptionItem } from '@/features/views/option-list';

export interface BuilderLookups {
  readonly projectId: string | null;
  readonly projects: readonly ProjectSummary[];
  /** Live programs (5.17: rules can work in one program and check the program or variant). */
  readonly programs: readonly ProgramListItemDTO[];
  /** The program the rule works in, when "Works in" is a program. */
  readonly program: ProgramListItemDTO | null;
  /** Variants of that program (the Variant condition needs one program). */
  readonly variants: readonly VariantDTO[];
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
  const programsQuery = usePrograms();
  const programs = useMemo(() => (programsQuery.data ?? []).filter((program) => !program.archivedAt), [programsQuery.data]);
  const program = project ? null : (programs.find((p) => p.id === projectId) ?? null);
  const containerKey = project?.key ?? program?.key ?? '';
  const detail = useProject(containerKey, { enabled: Boolean(containerKey) });
  const variantsQuery = useVariants(program?.key ?? '', false, { enabled: Boolean(program) });
  const people = usePeople();
  const labels = useLabels(projectId ?? null);
  return useMemo(() => {
    const statuses = containerKey ? (detail.data?.statuses ?? []) : [];
    const sections = containerKey ? (detail.data?.sections ?? []) : [];
    const labelList = labels.data ?? [];
    const personList = people.data ?? [];
    const variants = program ? (variantsQuery.data ?? []) : [];
    const byId = <T extends { id: string; name: string }>(list: readonly T[]) => {
      const map = new Map(list.map((item) => [item.id, item.name]));
      return (id: string) => map.get(id);
    };
    return {
      projectId,
      projects,
      programs,
      program,
      variants,
      statuses,
      sections,
      labels: labelList,
      people: personList,
      loading: Boolean(containerKey && detail.isLoading) || people.isLoading || labels.isLoading,
      describe: {
        status: byId(statuses),
        section: byId(sections),
        label: byId(labelList),
        person: byId(personList),
        project: byId([...projects, ...programs]),
        variant: byId(variants),
      },
    };
  }, [
    containerKey,
    detail.data,
    detail.isLoading,
    labels.data,
    labels.isLoading,
    people.data,
    people.isLoading,
    program,
    programs,
    projectId,
    projects,
    variantsQuery.data,
  ]);
}

/** True when the id is a program (rules scoped to a program, or a "the program is" rule). */
export function isProgramId(lookups: Pick<BuilderLookups, 'programs'>, id: string | null | undefined): boolean {
  return Boolean(id) && lookups.programs.some((program) => program.id === id);
}

export function sentenceFor(
  draft: {
    readonly trigger: AutomationTrigger;
    readonly conditions: readonly AutomationCondition[];
    readonly actions: readonly AutomationAction[];
  },
  lookups: DescribeLookups,
  programNames: readonly string[] = [],
  forBuilds = false,
): string {
  let sentence = describeAutomation(draft, lookups);
  if (forBuilds) sentence = buildWords(sentence);
  // Times read the way the pickers show them: "at 2:00 PM", not "at 14:00".
  sentence = sentence.replace(/\bat (\d{1,2}):(\d{2})\b/g, (_, hour: string, minute: string) => `at ${clockText(`${hour.padStart(2, '0')}:${minute}`)}`);
  // The engine words a container rule as "in the X project"; a program reads "in the X program".
  for (const name of programNames) sentence = sentence.replaceAll(`“${name}” project`, `“${name}” program`);
  return sentence;
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

export function programOptions(lookups: BuilderLookups): OptionItem[] {
  return lookups.programs.map((program) => ({
    value: program.id,
    label: program.name,
    keywords: program.key,
    hint: program.key,
    icon: <EntityIcon icon={program.icon} color={program.color} size={16} />,
  }));
}

export function variantOptions(lookups: BuilderLookups): OptionItem[] {
  return lookups.variants.map((variant) => ({
    value: variant.id,
    label: variant.name,
    keywords: variant.sku ?? undefined,
    hint: variant.sku ?? undefined,
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
