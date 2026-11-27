/**
 * Copy for /projects. Lists, names and counts come from the Projects app's own code through
 * src/generated/projects (refreshed by `sync:projects` on every build), so the page grows when the
 * app does. Notes per view and per link type are typed against the app's enums: add one in
 * apps/projects and this file stops type-checking until it has a line for it. The remaining prose
 * is hand-written; each feature it names is checked against the app's source by
 * src/lib/projects-claims.test.ts.
 */
import { PROJECTS_CATALOG } from '@/generated/projects/catalog';
import type { IntegrationTargetType, ViewType } from '@/generated/projects/constants';
import type { Feature } from '../product/chapter';
import type { FaqItem } from '../product/cta';
import type { HeroFact } from '../product/product-hero';
import type { SubNavSection } from '../product/sub-nav';

const { views, customFieldTypes, projectRoles, linkTargets, automation, recordTriggers, templates } = PROJECTS_CATALOG;

function list(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/** Lower-cases the first letter only, so names inside ("KitStak") keep their case. */
const lower = (items: readonly string[]): readonly string[] =>
  items.map((i) => i.charAt(0).toLowerCase() + i.slice(1));

/* ------------------------------------------------------------------ Views */

const VIEW_NOTES = {
  board: 'Drag tasks between the statuses your project defines, with limits on how much sits in a column.',
  list: 'Everything in order, grouped by section.',
  table: 'Edit in place, choose your columns, export to CSV.',
  timeline: 'Bars and dependency arrows, zoomed by day, week, month or quarter.',
  calendar: 'What is due, on the day it is due.',
  workload: 'Who has room, counted in tasks, points or hours.',
} as const satisfies Readonly<Record<ViewType, string>>;

export const PROJECT_VIEWS: readonly Feature[] = views.map((v) => ({ name: v.label, note: VIEW_NOTES[v.type] }));

/* ------------------------------------------------------------------ Page furniture */

export const SECTIONS: readonly SubNavSection[] = [
  { id: 'tasks', label: 'Tasks' },
  { id: 'views', label: 'Views' },
  { id: 'planning', label: 'Planning' },
  { id: 'templates', label: 'Templates' },
  { id: 'automations', label: 'Automations' },
  { id: 'stack', label: 'On the stack' },
  { id: 'pricing', label: 'Pricing' },
  { id: 'faq', label: 'FAQ' },
];

export const HERO_FACTS: readonly HeroFact[] = [
  { value: String(views.length), label: 'views of every project' },
  { value: String(customFieldTypes.length), label: 'custom field types' },
  { value: String(templates.length), label: 'project templates' },
  { value: String(automation.recipes.length), label: 'ready-made automations' },
];

/* ------------------------------------------------------------------ Chapters */

export const TASK_FEATURES: readonly Feature[] = [
  { name: 'Quick add', note: 'Type a task as one line. The date, priority, person, label and project are read out of it.' },
  { name: 'Task keys', note: 'Every task gets a short key like OPS-42 that people can say out loud.' },
  { name: 'Subtasks and dependencies', note: 'Break work down, and say what has to finish before what can start.' },
  { name: 'Your own statuses', note: 'Each project names its own steps between to do and done.' },
  { name: 'Custom fields', note: `${list(customFieldTypes.map((f) => f.label))}.` },
  { name: 'Recurring tasks', note: 'Finish one and the next is created for you.' },
  { name: 'Keyboard first', note: 'A command palette, shortcuts, and j and k to move through a list.' },
];

export const PLANNING_TILES: readonly Feature[] = [
  { name: 'Sections and milestones', note: 'Split a project into phases and mark the dates that matter.' },
  { name: 'Cycles', note: 'Time-boxed rounds of work with a goal. Unfinished tasks roll into the next one.' },
  { name: 'Triage', note: 'An intake queue. Accept, decline, snooze or merge what comes in.' },
  { name: 'Goals', note: 'Objectives with key results and check-ins, rolled up from projects.' },
  { name: 'Time tracking', note: 'Start a timer on a task or log time by hand.' },
  { name: 'Project health', note: 'On track, at risk or off track, visible from the project list.' },
  { name: 'Intake forms', note: 'A public link that turns each submission into a task.' },
  { name: 'Dashboards', note: 'Burn-up, velocity, cycle time, overdue by person and workload.' },
  {
    name: 'Roles',
    note: `${list(projectRoles)} on each project. Guests see only what they are added to.`,
  },
];

const triggerGroups = Array.from(new Set(automation.triggers.map((t) => t.group as string)));

export const AUTOMATION_FEATURES: readonly Feature[] = [
  { name: 'Written as a sentence', note: 'When this happens, and these conditions hold, do that.' },
  {
    name: `${automation.triggers.length} triggers and ${automation.actions.length} actions`,
    note: `Grouped as ${list(lower(triggerGroups))}: from a status change or a due date to a deal stage or a shipped order.`,
  },
  {
    name: `${automation.conditions.length} kinds of condition`,
    note: `Check ${list(automation.conditions.slice(0, 4))} and more before a rule runs.`,
  },
  { name: `${automation.recipes.length} ready-made recipes`, note: 'Start from one and change the parts you need.' },
  { name: 'Run history', note: 'See every time a rule ran and what it did.' },
];

/* ------------------------------------------------------------------ On the stack */

const LINK_NOTES = {
  crm_item: 'The deal the work is for, with its stage now.',
  crm_account: 'The account, and everything else linked to it.',
  core_customer: 'The shared customer every app reads.',
  wms_order: 'Type SO10482 in a task name and it links itself.',
  wms_work_order: 'Kitting and assembly jobs (WO codes).',
  wms_receipt: 'Inbound receipts (PO codes), with discrepancies.',
  wms_count: 'Cycle counts (CNT codes), with variances.',
} as const satisfies Readonly<Record<IntegrationTargetType, string>>;

export const LINK_DETAILS: readonly Feature[] = linkTargets.map((t) => ({ name: t.label, note: LINK_NOTES[t.type] }));

export const STACK_FEATURES: readonly Feature[] = [
  {
    name: 'Link work to the record it is about',
    note: `Attach a task or project to a ${list(linkTargets.map((t) => t.label.replace(/^(CRM|WMS) /, '')))}.`,
  },
  { name: 'Live status on the link', note: 'The linked record shows where it stands now, and opens in its own app.' },
  { name: 'One customer, three angles', note: 'A project for a customer shows their deal stage and what the warehouse sees.' },
  { name: 'Type a code, get a link', note: 'Write a warehouse order, receipt, work order or count number in a task name and it becomes a link.' },
  {
    name: `${recordTriggers.length} cross-app rules`,
    note: list(recordTriggers.map((r) => r.title.toLowerCase())) + '.',
  },
  // SPEC 8.4 of docs/pulse/SPEC.md: a "Job profit" strip on the project overview.
  { name: 'Job profit with Pulse', note: 'With Pulse, a project shows the profit on its linked jobs.' },
  { name: 'Only what you license', note: 'Links and rules for an app appear only if your organization runs that app.' },
];

/* ------------------------------------------------------------------ Pricing and FAQ */

export const PRICE_INCLUDED: readonly string[] = [
  `All ${views.length} views, cycles, triage and goals`,
  `${templates.length} templates, and your own`,
  `${automation.recipes.length} automation recipes and the rule builder`,
  'Intake forms, time tracking and dashboards',
  'Links to CRM and WMS records when you run them',
];

export const FAQ: readonly FaqItem[] = [
  {
    question: 'Does it work without the CRM or the WMS?',
    answer:
      'Yes. It runs on its own, with the same sign-in and organization as the other apps. The links to deals and warehouse records, and the rules that listen to those apps, appear when you also run them.',
  },
  {
    question: 'How is it priced?',
    answer:
      'Per user, like the CRM. One user count covers both when you run them together, and stacking it with another product takes the bundle saving off each.',
  },
  {
    question: 'Can we bring our own way of working?',
    answer: `Each project has its own statuses, sections, labels and custom fields. Start from one of the ${templates.length} built-in templates or save a project as your own template.`,
  },
  {
    question: 'Is there a mobile app?',
    answer: 'There is no app to install. It is a web app that adapts to a phone screen.',
  },
  {
    question: 'Already have an account?',
    answer:
      'Sign in at projects.kitstak.app with the same KitStak sign-in you use for the other apps. If your organization does not have Projects yet, get in touch and we will turn it on.',
  },
];
