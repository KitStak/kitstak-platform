/**
 * Copy for the /crm product page. Every capability named here exists in apps/crm today; keep it
 * that way when editing (no email sync, calling, quoting engine or AI claims).
 */
import type { Feature } from '../product/chapter';
import type { FaqItem } from '../product/cta';
import type { IntegrationGroup } from '../product/integrations';
import type { HeroFact } from '../product/product-hero';
import type { SubNavSection } from '../product/sub-nav';
import { COLUMN_TYPES } from './crm-static-visuals';

export const BOARD_VIEWS: readonly string[] = [
  'Table',
  'Kanban',
  'Calendar',
  'Timeline',
  'Chart',
  'Form',
  'File gallery',
  'Dashboard',
];

const DASHBOARD_WIDGETS: readonly string[] = [
  'Numbers',
  'Chart',
  'Battery',
  'Table',
  'Funnel',
  'Forecast',
  'Leaderboard',
  'Workload',
  'Calendar',
  'Timeline',
  'Countdown',
  'Text',
  'Section header',
];

const TEMPLATES: readonly string[] = [
  'Leads',
  'Deals',
  'Accounts',
  'Contacts',
  'Activities',
  'Customer onboarding',
  'Renewals',
  'Quotes and proposals',
  'Partner pipeline',
  'Campaign planner',
  'Events and webinars',
  'Support tickets',
  'Project tracker',
  'Vendor management',
  'Request intake',
  'Recruiting pipeline',
  'Employee onboarding',
];

export const SECTIONS: readonly SubNavSection[] = [
  { id: 'boards', label: 'Boards' },
  { id: 'sales', label: 'Sales' },
  { id: 'automations', label: 'Automations' },
  { id: 'dashboards', label: 'Dashboards' },
  { id: 'work', label: 'Inbox' },
  { id: 'start', label: 'Templates' },
  { id: 'admin', label: 'Admin' },
  { id: 'pricing', label: 'Pricing' },
  { id: 'faq', label: 'FAQ' },
];

export const HERO_FACTS: readonly HeroFact[] = [
  { value: String(BOARD_VIEWS.length), label: 'views of every board' },
  { value: String(COLUMN_TYPES.length), label: 'column types' },
  { value: String(DASHBOARD_WIDGETS.length), label: 'dashboard widgets' },
  { value: String(TEMPLATES.length), label: 'ready-made templates' },
];

export const BOARD_FEATURES: readonly Feature[] = [
  { name: 'Eight views, one set of records', note: `${BOARD_VIEWS.join(', ')}. Switch the view; the items stay put.` },
  { name: 'Groups and subitems', note: 'Break a board into stages or quarters, and a deal into its tasks.' },
  { name: 'Connected boards', note: 'Link a deal to its account and mirror the fields you need across.' },
  { name: 'Formulas and rollups', note: 'Progress, formula and mirror columns do the arithmetic for you.' },
  { name: 'Public forms', note: 'Share a form link and every submission lands as an item.' },
  { name: 'Command palette', note: 'Jump anywhere from the keyboard. Press G then P for the pipeline.' },
];

export const SALES_FEATURES: readonly Feature[] = [
  { name: 'Pipeline', note: 'A funnel by stage and a forecast, built from your deals board.' },
  { name: 'Leads', note: 'Qualify a lead, then convert it into a deal in one step.' },
  { name: 'Accounts and contacts', note: 'A 360° page for each one: deals, people, activity and files.' },
  { name: 'Activities', note: 'Log calls, meetings and follow-ups against the record they belong to.' },
  { name: 'Duplicates', note: 'Find records that are the same customer and merge them.' },
  { name: 'Renewals and onboarding', note: 'Boards for what happens after the deal is won.' },
];

export const AUTOMATION_FEATURES: readonly Feature[] = [
  {
    name: 'Six triggers',
    note: 'A status or column changes, a person is assigned, an item is created or moved, or a date arrives.',
  },
  { name: 'Conditions', note: 'Only run when a status, person, number or group matches.' },
  {
    name: 'Nine actions',
    note: 'Notify, post an update, set a status or date, assign, clear, move, archive or create an item.',
  },
  { name: 'Recipe gallery', note: 'Start from recipes for deals won and lost, close dates, due dates and more.' },
  { name: 'Test runs and history', note: 'Try a recipe before turning it on, and see every run after.' },
];

export const DASHBOARD_FEATURES: readonly Feature[] = [
  { name: `${DASHBOARD_WIDGETS.length} widgets`, note: `${DASHBOARD_WIDGETS.slice(0, 8).join(', ')} and more.` },
  { name: 'Across boards', note: 'Roll several boards up into the numbers your team reviews each week.' },
  { name: 'Live', note: 'Numbers move as the work does. No refresh, no export to check.' },
  { name: 'Filters and export', note: 'Narrow to a person or a period, and take the data with you.' },
];

export const WORK_FEATURES: readonly Feature[] = [
  { name: 'My Work', note: 'Everything assigned to you, across every board, in one list.' },
  { name: 'Inbox', note: 'Mentions, assignments, replies and due dates as they happen.' },
  { name: 'Updates', note: 'Rich-text notes on any item, with replies, reactions and who has seen it.' },
  { name: 'Files', note: 'Attach files to an item and browse them all in a gallery.' },
  { name: 'Activity log', note: 'What changed on an item, when, and who changed it.' },
];

export const START_TILES: readonly Feature[] = [
  { name: 'CRM suite', note: 'One click builds Leads, Deals, Accounts, Contacts and Activities, linked, with a sales dashboard.' },
  { name: `${TEMPLATES.length} templates`, note: 'Sales, marketing, customer success, projects, operations and HR.' },
  { name: 'Import a spreadsheet', note: 'CSV, TSV, TXT or XLSX. Upload, map the columns, review, done.' },
  { name: 'Export any time', note: 'Take a board out as CSV or XLSX. Your data is yours.' },
];

export const ADMIN_TILES: readonly Feature[] = [
  { name: 'Roles', note: 'Owner, admin, member, viewer and guest across the organization.' },
  { name: 'Board access', note: 'Owner, editor, viewer or subscriber, board by board.' },
  { name: 'Teams', note: 'Group people into teams for sharing and permissions.' },
  { name: 'Audit log', note: 'A record of who changed what across the organization.' },
  { name: 'REST API', note: 'Read and write your data with personal tokens scoped to what they need.' },
  { name: 'Webhooks', note: 'Signed events when items are created, updated, moved or change status.' },
];

export const CONNECT: readonly IntegrationGroup[] = [
  {
    title: 'Ways to connect',
    note: 'Webhooks post signed JSON to any automation tool or service you already run.',
    names: ['REST API', 'Signed webhooks', 'Zapier', 'Make', 'n8n', 'CSV and XLSX'],
  },
];

export const PRICE_INCLUDED: readonly string[] = [
  'Every board view and column type',
  'Automations with test runs',
  'Dashboards and the pipeline page',
  'All templates and the CRM suite',
  'API tokens and webhooks',
  'The KitStak portal and one sign-in',
];

export const FAQ: readonly FaqItem[] = [
  {
    question: 'Is this only for sales teams?',
    answer:
      'No. The CRM boards are where most teams start, but the same boards run onboarding, renewals, support tickets, projects and hiring. There are templates for each.',
  },
  {
    question: 'Can we import what we have today?',
    answer:
      'Yes. Upload a CSV, TSV, TXT or XLSX file, map its columns to board columns, review the result and import. You can export any board the same way.',
  },
  {
    question: 'Does it sync our email?',
    answer:
      'Not today. The CRM keeps the record of the relationship: deals, activities, updates and files. Notifications reach people in the app, and webhooks can pass events to the tools you already use.',
  },
  {
    question: 'How does it connect to other tools?',
    answer:
      'Through a REST API with scoped tokens and through signed webhooks, which work with Zapier, Make and n8n.',
  },
  {
    question: 'Can guests or clients see a board?',
    answer:
      'Yes. Invite someone as a guest or a viewer, and set their access board by board. Public forms let anyone submit without an account.',
  },
  {
    question: 'Can I use the CRM without the WMS?',
    answer:
      'Yes. Each product is licensed on its own. Add the warehouse later and link an account to see its stock and open orders.',
  },
];
