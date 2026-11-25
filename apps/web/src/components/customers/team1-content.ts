/**
 * The Team 1 customer story. Every number here is a record of the real move, from
 * `apps/crm/scripts/monday-migration/README.md` (the run on 2026-11-12) and the Team 1 floor the WMS
 * was built against (`apps/wms/references`). Do not round, pad or add numbers that are not in those
 * records. Team 1's own clients are never named.
 *
 * Team 1 and KitStak share a founder. The disclosure line must stay on every surface that shows
 * this story or its quote (FTC endorsement guides, 16 CFR 255.5).
 */

export const TEAM1 = {
  name: 'Team 1',
  industry: 'Fulfillment and supplier services',
  person: { name: 'Mike Lunsford', title: 'Managing Partner, Team 1' },
  disclosure: 'Team 1 and KitStak share a founder. Mike Lunsford runs Team 1 and built KitStak to run it.',
  /** The date the CRM move ran. ISO. */
  movedOn: '2026-11-12',
  quote:
    'We ran our clients in one tool and our floor in another, and the only thing connecting them was me. Now a client, its tasks and its orders are one record. That is the reason KitStak exists.',
  shortQuote: 'Now a client, its tasks and its orders are one record. That is the reason KitStak exists.',
} as const;

export interface StoryStat {
  readonly value: string;
  readonly label: string;
}

export const STATS: readonly StoryStat[] = [
  { value: '28', label: 'boards moved off monday.com' },
  { value: '210', label: 'items moved, with every status kept' },
  { value: '7', label: 'people on one sign-in' },
  { value: '1', label: 'day to move the CRM' },
];

export const BEFORE: readonly string[] = [
  'Client work lived in monday.com: 22 client boards and 6 project boards.',
  'The warehouse ran on Logiwa, with its own users and its own data.',
  'A project board did not know an order had shipped.',
  'The floor did not know which client tasks were waiting on it.',
  'Every answer about a client meant opening both and joining them by hand.',
];

export interface StoryStep {
  readonly title: string;
  readonly body: string;
}

export const MOVE_STEPS: readonly StoryStep[] = [
  {
    title: 'Count everything first',
    body: 'Two workspaces. "Project Tasks" held 22 client boards in a Task Keeper folder. "Product Connections" held 6 project boards. That count became the check at the end.',
  },
  {
    title: 'Leave the clutter behind',
    body: 'A sandbox workspace of copies stayed in monday.com. So did file attachments, comment threads, automations and custom views. Each one was a choice, made before the move.',
  },
  {
    title: 'People before items',
    body: 'All seven people were set up first, each with a role: one owner, one admin, one member and four viewers. The AI agent accounts in monday.com were left out on purpose.',
  },
  {
    title: 'Keep the words the team uses',
    body: 'Every status label came across as it was, with its old label ID kept alongside. An item that said "Waiting on client" the night before said it the next morning.',
  },
  {
    title: 'Run it so it can run again',
    body: 'The import skips any board that already exists. Boards were moved, checked with the team and moved again with no duplicates.',
  },
];

export interface FloorFact {
  readonly code: string;
  readonly label: string;
}

/** The Team 1 floor, as KitStak WMS models it. */
export const FLOOR: readonly FloorFact[] = [
  { code: 'O905', label: 'Aisle, column, level. Aisle O, column 9, level 5.' },
  { code: 'R01 to R03', label: 'Receiving doors' },
  { code: 'PS1 to PS4', label: 'Packing stations' },
  { code: 'RTS', label: 'Returns waiting to restock' },
  { code: 'QC HOLD', label: 'Stock held for a check' },
  { code: 'Cart 1', label: '24 bins, 4 levels by 6 columns' },
];

export const FLOOR_JOBS: readonly string[] = [
  'Single unit orders',
  'Multi item orders',
  'Cycle counts',
  'Replenishment',
];

export const TODAY: readonly StoryStep[] = [
  {
    title: 'One record per client',
    body: 'The client, its boards and its work sit in one database. Projects can link a task to the CRM deal or the WMS order it is for.',
  },
  {
    title: 'One sign-in',
    body: 'Seven people, one set of users and roles, across every KitStak app the team uses.',
  },
  {
    title: 'A WMS shaped by a real floor',
    body: 'KitStak WMS was built against Team 1’s own floor: its location codes, its carts, its pack stations and its job types.',
  },
];
