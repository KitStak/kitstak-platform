/**
 * Every signed in Crew route of docs/crew/SPEC.md section 6.1, with the teaching empty state it
 * shows until its build phase lands (section 12). One list, so the page, the palette, the search
 * page and the tests agree. Pure module (icons are mapped in src/features/phase/page-icons.tsx).
 *
 * Copy rule: plain 8th grade words, short sentences, never an em dash, en dash or double dash.
 */
import type { CrewAction } from './permissions';
import type { NavId } from './nav';

export type PageIcon = 'home' | 'today' | 'people' | 'person' | 'agency' | 'schedule' | 'template' | 'request' | 'clock' | 'me' | 'time' | 'fix' | 'export' | 'attendance' | 'timeOff' | 'skills' | 'plan' | 'pace' | 'import' | 'settings' | 'rules' | 'kiosk' | 'apps' | 'search';

/** The build phase that brings a page to life (SPEC 12). Phase 0 pages already work. */
export type BuildPhase = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface CrewPage {
  readonly id: string;
  /** The route pattern, as in SPEC 6.1. */
  readonly path: string;
  readonly title: string;
  readonly nav: NavId | null;
  readonly icon: PageIcon;
  readonly phase: BuildPhase;
  /** What the person needs to open the page. `self` = any signed in user linked to a live person. */
  readonly needs: CrewAction | 'self';
  /** One or two plain sentences: what this is and why it matters. */
  readonly why: string;
  /** What will show up here once the phase lands (up to four). */
  readonly points: readonly string[];
}

export const PHASE_NAMES: Readonly<Record<BuildPhase, string>> = {
  0: 'Setup',
  1: 'People and import',
  2: 'Schedule',
  3: 'Time clock',
  4: 'Approve hours and export',
  5: 'Attendance and time off',
  6: 'Skills',
  7: 'Labor plan',
  8: 'Connected apps',
};

/** The last build phase that is live: pages of this phase or earlier render their real screens. */
export const BUILT_PHASE: BuildPhase = 1;

/** "Arrives in phase 3: Time clock". */
export function arrivesIn(phase: BuildPhase): string {
  return `Arrives in phase ${phase}: ${PHASE_NAMES[phase]}`;
}

export const CREW_PAGES: readonly CrewPage[] = [
  {
    id: 'home', path: '/', title: 'Home', nav: 'home', icon: 'home', phase: 3, needs: 'crew:read',
    why: 'Home shows each site at a glance, so you know where to look first each morning.',
    points: ['Who is on site now, and who is scheduled but not here yet', 'Hours worked this week against hours scheduled', 'Time cards that need a fix, worst first', 'Days in the next three that are people short'],
  },
  {
    id: 'today', path: '/today', title: 'Today', nav: 'today', icon: 'today', phase: 3, needs: 'crew:read',
    why: 'The daily board for each site. It refreshes on its own, so a supervisor can keep it open on the floor.',
    points: ['Who is clocked in, since when, and on which job or area', 'Who is late after the grace time, with the minutes', 'Who is out today, and who is here with no shift', 'Mark someone as called out with one tap'],
  },
  {
    id: 'people', path: '/people', title: 'People', nav: 'people', icon: 'people', phase: 1, needs: 'crew:read',
    why: 'Everyone who works the floor lives here, temps included. Most people never need a login.',
    points: ['Search and filter by site, kind, status and agency', 'Bulk actions: set site, set lead, print PIN slips', 'Export the list you are looking at as a CSV file', 'Bring in a whole agency crew from one file'],
  },
  {
    id: 'people-new', path: '/people/new', title: 'Add a person', nav: 'people', icon: 'person', phase: 1, needs: 'person:manage',
    why: 'One short form adds a person: name, number, site, area, lead and, for temps, their agency.',
    points: ['Crew makes a number for temps when you leave it blank', 'Link the person to a login so they can use the phone clock', 'Pay and private details only for people allowed to see them', 'Print a PIN slip for the time clock when you save'],
  },
  {
    id: 'person', path: '/people/[id]', title: 'Person', nav: 'people', icon: 'person', phase: 1, needs: 'crew:read',
    why: 'Everything about one person in one place, with tabs for their schedule, time, attendance and skills.',
    points: ['Status, site, labor class, lead and agency', 'Kiosk PIN and badge resets', 'Pay type and dated wages, for payroll only', 'Every change, with who made it and when'],
  },
  {
    id: 'agencies', path: '/people/agencies', title: 'Agencies', nav: 'people', icon: 'agency', phase: 1, needs: 'person:manage',
    why: 'The temp agencies that send you people. Each agency is one shared vendor, the same one Ledger pays.',
    points: ['Contact details and active people per agency', 'This week of approved hours per agency', 'Agency links: the agency types in its own people', 'Accept or reject what an agency sends, in bulk'],
  },
  {
    id: 'agency', path: '/people/agencies/[vendorId]', title: 'Agency', nav: 'people', icon: 'agency', phase: 1, needs: 'person:manage',
    why: 'One agency: who it sent, their hours, its links and what is waiting for you to accept.',
    points: ['Active people from this agency', 'Approved hours by week', 'Make, copy and revoke agency links', 'Pending people to accept or reject'],
  },
  {
    id: 'schedule', path: '/schedule', title: 'Schedule', nav: 'schedule', icon: 'schedule', phase: 2, needs: 'schedule:read',
    why: 'Build the week for one site from your shift templates, then publish it so everyone sees their shifts.',
    points: ['People by area down, days across, shifts in the cells', 'Open slots, copy last week and clear the draft', 'Warnings for time off, overlaps and over 40 hours', 'Publish once, then send only the changes'],
  },
  {
    id: 'schedule-templates', path: '/schedule/templates', title: 'Shift templates', nav: 'schedule', icon: 'template', phase: 2, needs: 'schedule:draft',
    why: 'Templates are your usual shifts, like First 6:00 AM to 2:30 PM. The schedule is built from them.',
    points: ['Start and end times, breaks and days of the week', 'How many people each shift needs', 'What each shift requires, like a forklift card', 'One list per site'],
  },
  {
    id: 'schedule-requests', path: '/schedule/requests', title: 'Shift requests', nav: 'schedule', icon: 'request', phase: 2, needs: 'request:decide',
    why: 'People ask to pick up, swap or drop shifts from My work. You decide here.',
    points: ['Every pickup, swap and drop waiting for you', 'The warnings each one would cause', 'Approve or decline with a note', 'Requests end on their own when the shift starts'],
  },
  {
    id: 'clock', path: '/clock', title: 'Phone clock', nav: null, icon: 'clock', phase: 3, needs: 'self',
    why: 'Clock in and out from your phone, in English or Spanish, when your shop allows it.',
    points: ['The same buttons as the time clock at the door', 'Start and end breaks, switch job or area', 'Your supervisor sees when you clock in far from the site', 'Only the distance is kept, never where you are'],
  },
  {
    id: 'me', path: '/me', title: 'My work', nav: null, icon: 'me', phase: 2, needs: 'self',
    why: 'Your own shifts, time card, time off and certifications, in one place.',
    points: ['Your next shifts and open shifts you can pick up', 'Ask to swap or drop a shift', 'Your time card this week and last', 'Tell your supervisor you will miss a shift'],
  },
  {
    id: 'time', path: '/time', title: 'Time', nav: 'time', icon: 'time', phase: 4, needs: 'crew:read',
    why: 'Time cards for one site and week. Fix what needs a fix, then approve the week for payroll.',
    points: ['Daily hours per person: regular, overtime and double time', 'Needs a fix chips, like a missing clock out', 'Approve the week, with a list of what blocks it', 'Approved weeks lock, and only payroll can reopen them'],
  },
  {
    id: 'time-person', path: '/time/[personId]', title: 'Time card', nav: 'time', icon: 'time', phase: 4, needs: 'crew:read',
    why: 'One person, one week, day by day: every punch, the real and rounded times, and how the hours were split.',
    points: ['Punches with areas, jobs and breaks', 'How we got this: which rules made overtime', 'Add, change or void a punch, always with a reason', 'The original stays, struck through, beside the fix'],
  },
  {
    id: 'time-fixes', path: '/time/fixes', title: 'Needs a fix', nav: 'time', icon: 'fix', phase: 4, needs: 'punch:edit',
    why: 'Every time card that needs a fix, across sites and weeks, so nothing slips past payroll.',
    points: ['Missing clock outs and missing break ends', 'Punches out of order and failed PINs', 'Fix each one in place with a reason', 'Missing punches are never guessed'],
  },
  {
    id: 'time-export', path: '/time/export', title: 'Payroll export', nav: 'time', icon: 'export', phase: 4, needs: 'export:payroll',
    why: 'Send approved hours to payroll as a file. Each export is logged, so you know when a week changed after it was sent.',
    points: ['Pick approved weeks and sites', 'By week or by day layouts', 'Preview the rows before you download', 'A warning when a week changed after its export'],
  },
  {
    id: 'attendance', path: '/attendance', title: 'Attendance', nav: 'attendance', icon: 'attendance', phase: 5, needs: 'attendance:read',
    why: 'Late, early out, no call no show and called out, found from the schedule and the clock each night.',
    points: ['Events by site and date range', 'A count per person for the range', 'Excuse or void an event with a reason', 'Approved time off never makes an event'],
  },
  {
    id: 'time-off', path: '/time-off', title: 'Time off', nav: 'time-off', icon: 'timeOff', phase: 5, needs: 'timeoff:decide',
    why: 'Requests to decide, who is out, and balances, in one place.',
    points: ['Approve or decline, with the shifts it would clear', 'A calendar of who is out by site', 'Balances that payroll can set, adjust or import', 'Time off types like Paid time off, Sick and Unpaid'],
  },
  {
    id: 'skills', path: '/skills', title: 'Skills', nav: 'skills', icon: 'skills', phase: 6, needs: 'crew:read',
    why: 'Who is trained on what, and whose cards are about to end, before it stops a shift.',
    points: ['People down, certifications and skills across', 'Cards ending in the next 60 days', 'Upload a card copy from the cell', 'Warnings when someone is scheduled without a card'],
  },
  {
    id: 'plan', path: '/plan', title: 'Labor plan', nav: 'plan', icon: 'plan', phase: 7, needs: 'plan:read',
    why: 'How many people each of the next 14 days needs against how many are scheduled.',
    points: ['Hours needed and people needed per day', 'People short or people extra, per site', 'Fill the gap opens the schedule with open shifts', 'New work from won deals, with the people it needs'],
  },
  {
    id: 'plan-paces', path: '/plan/paces', title: 'Target pace', nav: 'plan', icon: 'pace', phase: 7, needs: 'plan:manage',
    why: 'How many units one person does in an hour, for warehouse work Pulse has no pace for.',
    points: ['Paces by site and activity', 'Kit builds, receiving, pick and pack', 'Dated, so old plans keep their numbers', 'Pulse paces are used when Pulse has one'],
  },
  {
    id: 'import', path: '/import', title: 'Import', nav: 'import', icon: 'import', phase: 1, needs: 'import:run',
    why: 'Bring in people, certifications, skills, balances and plan inputs from a spreadsheet.',
    points: ['Templates for every file', 'Plain error messages on the exact cell', 'All or nothing, or skip bad rows', 'Undo for 7 days'],
  },
  {
    id: 'import-batch', path: '/import/[batchId]', title: 'Import', nav: 'import', icon: 'import', phase: 1, needs: 'import:run',
    why: 'One file you brought in: what was added, changed, skipped and why.',
    points: ['Row by row results', 'A file of the rows with errors', 'Print PIN slips for new people', 'Undo the whole file'],
  },
  {
    id: 'export', path: '/export', title: 'Export', nav: 'import', icon: 'export', phase: 1, needs: 'export:run',
    why: 'Download any part of your Crew data as CSV files that open in Excel.',
    points: ['People, certifications, skills and plan inputs', 'Hours and punches, from approved weeks', 'Date range and site filters', 'The same columns as the import templates'],
  },
  {
    id: 'settings', path: '/settings', title: 'Settings', nav: 'settings', icon: 'settings', phase: 1, needs: 'settings:manage',
    why: 'Set Crew up for how your floor works: sites and areas, roles, time off types and notices.',
    points: ['Sites, areas, time zones and the phone clock fence', 'Labor classes and who can see pay', 'Crew roles and site scope for each person', 'Sample data and the audit log'],
  },
  {
    id: 'settings-rules', path: '/settings/rules', title: 'Labor rules', nav: 'settings', icon: 'rules', phase: 3, needs: 'rules:manage',
    why: 'Overtime, rounding, grace times and break rules, per site, with an effective date.',
    points: ['Federal or California presets, or your own', 'Rounding that never goes against the worker', 'Meal and rest break checks', 'A live preview of this week under the rules'],
  },
  {
    id: 'settings-kiosks', path: '/settings/kiosks', title: 'Time clocks', nav: 'settings', icon: 'kiosk', phase: 3, needs: 'kiosk:manage',
    why: 'Any tablet becomes a time clock at the door. Make a device link here and open it on the tablet.',
    points: ['Badge, number and PIN, or both', 'Photo on punch and language', 'Last seen and clock skew per tablet', 'Revoke a lost tablet in one tap'],
  },
  {
    id: 'settings-apps', path: '/settings/apps', title: 'Connected apps', nav: 'settings', icon: 'apps', phase: 8, needs: 'settings:manage',
    why: 'What flows between Crew and your other KitStak apps, and when it last synced.',
    points: ['Approved hours to Pulse as paid hours', 'Builds from Projects and work from WMS into the plan', 'Won deals from CRM as early warnings', 'Agency hours for Ledger to check bills'],
  },
];

export function crewPage(id: string): CrewPage {
  const page = CREW_PAGES.find((entry) => entry.id === id);
  if (!page) throw new Error(`Unknown Crew page: ${id}`);
  return page;
}
