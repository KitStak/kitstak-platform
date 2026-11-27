/**
 * Copy for /crew. Crew is a planned app with no code yet, so every line here comes from
 * docs/crew/REFERENCE.md and is written as what Crew will do, never as a screen that exists.
 * Where the reference lists an open question (section 9), the page leaves it out or says it is
 * still being decided. Copy rules: plain words, short sentences, no em or en dash.
 */
import type { Feature } from '../product/chapter';
import type { FaqItem } from '../product/cta';
import type { HeroFact } from '../product/product-hero';
import type { SubNavSection } from '../product/sub-nav';

export const META = {
  title: 'KitStak Crew - schedules, time clock and labor planning for the floor (coming soon)',
  description:
    'KitStak Crew is coming soon: people, shifts, a time clock kiosk, attendance, skills and a labor plan for kitting, 3PL and contract packaging floors.',
  socialTitle: 'KitStak Crew. Staff it. Clock it. Plan it.',
  socialDescription: 'The people app for the floor, on the same stack as Pulse, the WMS and Projects. Coming soon.',
  url: 'https://kitstak.com/crew',
} as const;

export const HERO = {
  product: 'KitStak Crew',
  lines: ['Staff it.', 'Clock it.', 'Plan it.'],
  lead: 'Crew is the people app for kitting, 3PL and contract packaging floors. Schedule shifts, clock people in at a kiosk by the door, and see how many people tomorrow needs before tomorrow starts.',
  howLabel: 'See how it works',
} as const;

export const HERO_FACTS: readonly HeroFact[] = [
  { value: '6', label: 'parts: people, shifts, clock, attendance, skills, planning' },
  { value: '0', label: 'logins needed to clock in at the kiosk' },
  { value: '1', label: 'record per person, temps included' },
  { value: '2', label: 'languages planned for the floor: English and Spanish' },
];

export const SECTIONS: readonly SubNavSection[] = [
  { id: 'people', label: 'People' },
  { id: 'shifts', label: 'Shifts' },
  { id: 'clock', label: 'Time clock' },
  { id: 'attendance', label: 'Attendance' },
  { id: 'skills', label: 'Skills' },
  { id: 'planning', label: 'Labor plan' },
  { id: 'stack', label: 'On the stack' },
  { id: 'pricing', label: 'Pricing' },
  { id: 'faq', label: 'FAQ' },
];

export const CHAPTERS = {
  problem: {
    id: 'problem',
    index: '01',
    label: 'The problem',
    title: 'Labor is your biggest cost. Nobody knows who showed up.',
    lead: 'The schedule lives on a whiteboard, the hours come from a punch file, and the plan for Tuesday is a guess. Crew puts the floor’s people in one place.',
  },
  people: {
    id: 'people',
    index: '02',
    label: 'People',
    title: 'Everyone on the floor. Not just the people who log in.',
    lead: 'Most floor workers, and most temps, never sign in to anything. In Crew a person is their own record, with a link to a login only when they need one.',
  },
  shifts: {
    id: 'shifts',
    index: '03',
    label: 'Shifts',
    title: 'A schedule you can publish, not a whiteboard you photograph.',
    lead: 'Build the week from shift templates by site and area, fill the open shifts, and let people swap and pick up. Publish it and everyone is told.',
  },
  clock: {
    id: 'clock',
    index: '04',
    label: 'Time clock',
    title: 'A kiosk by the door. Built for gloves and bad Wi-Fi.',
    lead: 'People clock in on a shared tablet with a badge or a PIN, or on their phone inside the site fence. Breaks and job switches are part of the punch.',
  },
  attendance: {
    id: 'attendance',
    index: '05',
    label: 'Attendance',
    title: 'Who is here, who is late, and who is out.',
    lead: 'Late, early out and no call no show are recorded as they happen. Time off is asked for and approved in one place, and the daily board shows who is on site.',
  },
  skills: {
    id: 'skills',
    index: '06',
    label: 'Skills',
    title: 'Never schedule someone who is not cleared.',
    lead: 'Certifications carry an expiry date. Crew warns you before you put someone on a forklift with a card that ran out last week.',
  },
  planning: {
    id: 'planning',
    index: '07',
    label: 'Labor plan',
    title: '1,200 kits on Tuesday. How many people is that?',
    lead: 'Crew turns planned units into hours, and hours into people, then sets that beside who is scheduled. The gap is the number you call the agency about.',
  },
  stack: {
    id: 'stack',
    index: '08',
    label: 'On the stack',
    title: 'The hours go where the money is counted.',
    lead: 'Approved hours flow into Pulse as paid hours, with no punch file in between. The plan reads the work from Projects and the WMS. Ledger checks the temp agency’s bill.',
  },
} as const;

export const PROBLEM_TILES: readonly Feature[] = [
  { name: 'A punch file every week', note: 'Paid hours arrive from payroll as a file, then someone types them into the cost model.' },
  { name: 'A schedule on a whiteboard', note: 'Open shifts and swaps happen by text. Nobody is sure what the final week looked like.' },
  { name: 'Temps you cannot see', note: 'Agency people never get a login, so they never get a record either.' },
  { name: 'Expired certifications', note: 'Forklift cards run out, and the first sign is a near miss.' },
  { name: 'A plan that is a guess', note: 'Planned units are known days ahead. The people needed for them are worked out the morning of.' },
  { name: 'Two lists of people', note: 'The WMS knows who did the task. Payroll knows who got paid. They are not the same list.' },
];

export const PEOPLE_FEATURES: readonly Feature[] = [
  { name: 'Employees, temps and seasonal hires', note: 'One record for everyone who works the floor, whoever pays them.' },
  { name: 'Site, labor class and pay type', note: 'Plus agency, start date, status and an emergency contact.' },
  { name: 'A login only if they need one', note: 'Link a person to a sign-in when they lead a crew or approve time.' },
  { name: 'Peak season in minutes', note: 'Add 30 agency people from a spreadsheet, or a link the agency fills in.' },
  { name: 'One record with the WMS', note: 'Associates in WMS labor analytics resolve to Crew people.' },
];

export const SHIFT_FEATURES: readonly Feature[] = [
  { name: 'Shift templates', note: 'First, second and weekend shifts, reused week to week.' },
  { name: 'Weekly schedule by site and area', note: 'The whole floor on one screen, area by area.' },
  { name: 'Open shifts, swaps and pickups', note: 'People ask, a lead approves, the schedule updates.' },
  { name: 'Publish and notify', note: 'Everyone on the schedule is told when it goes out or changes.' },
];

export const CLOCK_FEATURES: readonly Feature[] = [
  { name: 'Shared kiosk', note: 'A badge or a PIN at a tablet by the door, with an optional photo.' },
  { name: 'Phone clock in', note: 'Inside a site fence you set, so nobody clocks in from the parking lot.' },
  { name: 'Breaks and job switches', note: 'Move between jobs and areas during the shift without a new punch sheet.' },
  { name: 'Works through drops', note: 'Punches keep saving when the network drops, and sync when it is back.' },
  { name: 'Edits keep the original', note: 'A supervisor change keeps who changed it, when and why. Approved weeks lock.' },
];

export const ATTENDANCE_FEATURES: readonly Feature[] = [
  { name: 'Late, early out, no call no show', note: 'Recorded from the punches, not typed in afterwards.' },
  { name: 'Time off requests and balances', note: 'Asked for, approved and counted in one place.' },
  { name: 'Who is here today', note: 'A daily board of who is on site, by area.' },
  { name: 'Points or occurrences', note: 'Whether a points policy is in the first release is still being decided.' },
];

export const SKILL_FEATURES: readonly Feature[] = [
  { name: 'Certifications with expiry', note: 'Forklift, reach truck, hazmat, or your own list.' },
  { name: 'Trained on', note: 'A kit, a line, or a client’s program.' },
  { name: 'Skill level', note: 'So the plan can put a lead where a lead is needed.' },
  { name: 'Warnings before scheduling', note: 'Crew tells you before you schedule someone who is not cleared.' },
];

export const PLANNING_FEATURES: readonly Feature[] = [
  { name: 'Hours needed per day', note: 'Planned units divided by your target pace, plus setup and indirect time.' },
  { name: 'People needed', note: 'Hours divided by shift length, rounded up.' },
  { name: 'The gap', note: 'People needed minus people scheduled, day by day.' },
  { name: 'What temps would cost', note: 'Using the loaded rates Pulse already holds, so a rate never lives in two places.' },
  { name: 'An early warning from the CRM', note: 'Won deals with a start date show the people new programs will need.' },
];

export const STACK_FEATURES: readonly Feature[] = [
  { name: 'Pulse', note: 'Approved paid hours per person, day, site and labor class, with overtime. Replaces the punch file.' },
  { name: 'Ledger', note: 'Approved hours per temp agency and week, to check the agency’s bill.' },
  { name: 'WMS', note: 'Who is on site and cleared for what, so tasks skip people who are out or not certified.' },
  { name: 'Projects', note: 'Planned units and due dates feed the labor plan. Time off shows on workload.' },
];

/** The labor plan, as the reference writes it (docs/crew/REFERENCE.md 5.4). */
export const LABOR_PLAN_LINES = [
  'hours_needed  = planned_units / target_units_per_labor_hour + setup_hours + indirect_allowance',
  'people_needed = ceil(hours_needed / shift_length)',
  'gap           = people_needed - people_scheduled',
] as const;

/** A worked day: 1,200 kits at 16 kits per labor hour, 4 setup hours, 6 indirect, 8 hour shifts. */
export const LABOR_PLAN_EXAMPLE = [
  { label: 'Planned units', value: '1,200 kits' },
  { label: 'Target pace', value: '16 kits per labor hour' },
  { label: 'Hours needed', value: '75 + 4 setup + 6 indirect = 85' },
  { label: 'People needed', value: '85 / 8 hour shift = 11' },
  { label: 'Scheduled', value: '8' },
  { label: 'Gap', value: '3 people short' },
] as const;

export const PRICE_INCLUDED: readonly string[] = [
  'Everyone on the floor counts, temps included',
  'Shift templates, the weekly schedule and swaps',
  'Kiosk and phone time clock',
  'Attendance, time off and the daily board',
  'Certifications and skills with expiry warnings',
  'The labor plan and the people gap',
  'Hours export to your payroll provider',
];

export const FAQ_TITLE = 'Before you ask.';

export const FAQ: readonly FaqItem[] = [
  {
    question: 'When can I use Crew?',
    answer:
      'Crew is coming soon and cannot be bought yet. Ask to be told when it is ready and we will email you once, when you can start.',
  },
  {
    question: 'Does Crew run payroll?',
    answer:
      'No. Crew approves hours and exports them to your payroll provider. Which providers come first is still being decided. Ledger books the payroll journal that comes back.',
  },
  {
    question: 'Do my floor workers need a login?',
    answer:
      'No. A person clocks in at the kiosk with a badge or a PIN. Only people who lead a crew or approve time need to sign in.',
  },
  {
    question: 'Where do pay rates live?',
    answer:
      'In Pulse, with your labor classes and loaded rates. Crew reads them from there. Without Pulse, Crew keeps a plain wage per person for its own estimates, and that moves into Pulse when you add it.',
  },
  {
    question: 'What about overtime and break rules in my state?',
    answer:
      'Rules like daily overtime, meal and rest breaks and rounding are kept as settings per site, not hard wired. Crew never rounds in the shop’s favor by default.',
  },
  {
    question: 'Who can see pay and attendance?',
    answer:
      'A lead sees their crew’s schedule and punches, not pay. Admins and payroll see pay. Wages, attendance points and personal details are treated as sensitive.',
  },
  {
    question: 'Can I use Crew without the other apps?',
    answer:
      'Yes. On its own you get scheduling, a time clock, attendance and skills, and you export hours to payroll. Add Pulse later and those hours become job cost with no file in between.',
  },
];

export const CLOSING = {
  title: 'The fifth bar is for the people.',
  note: 'Crew is coming soon. It will run on its own, or alongside Pulse, the WMS and Projects with one sign-in.',
} as const;
