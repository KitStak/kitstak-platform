/**
 * Copy for the /projects preview page. KitStak Projects is in development and not yet available.
 * Every capability named here exists in the Projects app's code as of the preview (apps/projects
 * on its development branch); nothing here is a roadmap item. Recheck this file when the app ships.
 */
import type { Feature } from '../product/chapter';
import type { FaqItem } from '../product/cta';
import type { HeroFact } from '../product/product-hero';
import type { SubNavSection } from '../product/sub-nav';

export const PROJECT_VIEWS: readonly Feature[] = [
  { name: 'Board', note: 'Drag tasks between the statuses your project defines.' },
  { name: 'List', note: 'Everything in order, grouped by section.' },
  { name: 'Table', note: 'Edit in place, choose your columns, export to CSV.' },
  { name: 'Timeline', note: 'Bars and dependency arrows, zoomed by day, week, month or quarter.' },
  { name: 'Calendar', note: 'What is due, on the day it is due.' },
  { name: 'Workload', note: 'Who has room, counted in tasks, points or hours.' },
];

const CUSTOM_FIELD_TYPES = 9;
const TEMPLATES: readonly string[] = [
  'Product launch',
  'Client onboarding',
  'Warehouse go-live',
  'Sales deal handoff',
  'Two-week sprint',
  'Event plan',
  'Marketing campaign',
];
const RECIPES = 15;

export const SECTIONS: readonly SubNavSection[] = [
  { id: 'tasks', label: 'Tasks' },
  { id: 'views', label: 'Views' },
  { id: 'planning', label: 'Planning' },
  { id: 'automations', label: 'Automations' },
  { id: 'stack', label: 'On the stack' },
  { id: 'faq', label: 'FAQ' },
];

export const HERO_FACTS: readonly HeroFact[] = [
  { value: String(PROJECT_VIEWS.length), label: 'views of every project' },
  { value: String(CUSTOM_FIELD_TYPES), label: 'custom field types' },
  { value: String(TEMPLATES.length), label: 'project templates' },
  { value: String(RECIPES), label: 'ready-made automations' },
];

export const TASK_FEATURES: readonly Feature[] = [
  { name: 'Quick add', note: 'Type a task as one line. The date, priority, person and label are read out of it.' },
  { name: 'Task keys', note: 'Every task gets a short key like OPS-42 that people can say out loud.' },
  { name: 'Subtasks and dependencies', note: 'Break work down, and say what has to finish before what can start.' },
  { name: 'Your own statuses', note: 'Each project names its own steps between to do and done.' },
  { name: 'Custom fields', note: 'Text, number, select, multi-select, date, person, checkbox, currency and link.' },
  { name: 'Recurring tasks', note: 'Finish one and the next is created for you.' },
  { name: 'Keyboard first', note: 'A command palette, shortcuts, and j and k to move through a list.' },
];

export const PLANNING_TILES: readonly Feature[] = [
  { name: 'Sections and milestones', note: 'Split a project into phases and mark the dates that matter.' },
  { name: 'Cycles', note: 'Time-boxed rounds of work with a goal. Unfinished tasks roll into the next one.' },
  { name: 'Triage', note: 'An intake queue. Accept, decline, snooze or merge what comes in.' },
  { name: 'Goals', note: 'Objectives with key results and check-ins, rolled up from projects.' },
  { name: 'Templates', note: `${TEMPLATES.slice(0, 4).join(', ')} and more. Save your own.` },
  { name: 'Time tracking', note: 'Start a timer on a task or log time by hand.' },
  { name: 'Project health', note: 'On track, at risk or off track, visible from the project list.' },
  { name: 'Intake forms', note: 'A public link that turns each submission into a task.' },
  { name: 'Roles', note: 'Owner, editor, commenter or viewer on each project. Guests see only what they are added to.' },
];

export const AUTOMATION_FEATURES: readonly Feature[] = [
  { name: 'Written as a sentence', note: 'When this happens, and these conditions hold, do that.' },
  { name: '14 triggers and 15 actions', note: 'From a status change or a due date to a deal stage or a shipped order.' },
  { name: `${RECIPES} ready-made recipes`, note: 'Start from one and change the parts you need.' },
  { name: 'Run history', note: 'See every time a rule ran and what it did.' },
  { name: 'Dashboards', note: 'Burn-up, velocity, cycle time, overdue by person and workload.' },
];

export const STACK_FEATURES: readonly Feature[] = [
  {
    name: 'Link work to the record it is about',
    note: 'Attach a task or project to a CRM deal or account, a customer, or a warehouse order, work order, receipt or count.',
  },
  { name: 'Live status on the link', note: 'The linked record shows where it stands now, and opens in its own app.' },
  { name: 'One customer, three angles', note: 'A project for a customer shows their deal stage and what the warehouse sees.' },
  { name: 'Type a code, get a link', note: 'Write a warehouse order number in a task name and it becomes a link.' },
  { name: 'Only what you license', note: 'Links to an app appear only if your organization runs that app.' },
];

export const FAQ: readonly FaqItem[] = [
  {
    question: 'Can I use KitStak Projects today?',
    answer:
      'Not yet. It is in development and there is no release date to share. Ask for early access and say how you run projects now.',
  },
  {
    question: 'Will it work without the CRM or the WMS?',
    answer:
      'Yes. It is designed to run on its own, with the same sign-in and organization as the other apps. The links to deals and warehouse records appear when you also run those apps.',
  },
  {
    question: 'What will it cost?',
    answer: 'Pricing is not set. It will be licensed as its own product, like the CRM and the WMS.',
  },
  {
    question: 'Is there a mobile app?',
    answer: 'There is no app to install. It is a web app that adapts to a phone screen.',
  },
  {
    question: 'What can I do in the meantime?',
    answer:
      'The CRM and the WMS are available now. The CRM includes project-tracking board templates, and your customers and team will already be in place when Projects arrives.',
  },
];
