/**
 * The quick-add demo on /projects runs KitStak Projects' own parser (copied verbatim from
 * apps/projects/src/lib by scripts/sync-projects.ts). This file only supplies a small sample
 * workspace for it to resolve names against, and turns the parse into what the demo shows.
 */
import { parseQuickAdd } from '@/generated/projects/nl-parse';
import type { QuickAddParse, QuickAddToken } from '@/generated/projects/nl-parse';
import { INTEGRATION_TARGET_LABELS } from '@/generated/projects/constants';
import { findWmsCodes, normalizeWmsCodes } from '@/generated/projects/wms-codes';

export const DEMO_PEOPLE = [
  { id: 'u-dana', name: 'Dana Reyes' },
  { id: 'u-marcus', name: 'Marcus Tran' },
  { id: 'u-ari', name: 'Ari Kim' },
  { id: 'u-priya', name: 'Priya Shah' },
] as const;

export const DEMO_PROJECTS = [
  { id: 'p-ops', key: 'OPS', name: 'Warehouse go-live' },
  { id: 'p-onb', key: 'ONB', name: 'Client onboarding' },
] as const;

export const DEMO_LABELS = [
  { id: 'l-warehouse', name: 'Warehouse' },
  { id: 'l-onboarding', name: 'Onboarding' },
  { id: 'l-sales', name: 'Sales' },
] as const;

export const EXAMPLES: readonly string[] = [
  'Print pallet labels next fri !high @dana #warehouse',
  'Chase the short receipt on po2240 tomorrow !urgent @ari',
  'Send the kickoff deck in 3 days @marcus #onboarding +ONB',
];

const MAX_INPUT = 200;

export interface DemoLink {
  readonly code: string;
  readonly label: string;
}

export interface DemoTask {
  readonly key: string;
  readonly title: string;
  readonly parse: QuickAddParse;
  /** WMS records the title names; the app turns each into a linked-record chip. */
  readonly links: readonly DemoLink[];
}

/** Runs the real quick-add parser over one typed line, against the sample workspace. */
export function demoTask(input: string, today: string, nextNumber = 46): DemoTask {
  const parse = parseQuickAdd(input.slice(0, MAX_INPUT), {
    today,
    people: DEMO_PEOPLE,
    projects: DEMO_PROJECTS,
    labels: DEMO_LABELS,
    createUnknownLabels: true,
  });
  const matches = findWmsCodes(parse.title);
  const project = DEMO_PROJECTS.find((p) => p.id === parse.projectId) ?? DEMO_PROJECTS[0];
  return {
    key: `${project.key}-${nextNumber}`,
    title: normalizeWmsCodes(parse.title, matches),
    parse,
    links: matches.map((m) => ({ code: m.code, label: INTEGRATION_TARGET_LABELS[m.type] })),
  };
}

const KIND_LABEL: Readonly<Record<QuickAddToken['kind'], string>> = {
  date: 'Due',
  priority: 'Priority',
  assignee: 'Assignee',
  label: 'Label',
  project: 'Project',
};

export function tokenKindLabel(token: QuickAddToken): string {
  return KIND_LABEL[token.kind];
}
