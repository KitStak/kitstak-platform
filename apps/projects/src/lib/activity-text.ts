/**
 * Plain-language sentence for an activity row, without the actor ("moved this to Done").
 * Shared by the task activity feed, the project Activity tab and dashboards.
 */
import { undash } from './undash';
import { PRIORITY_LABELS, type Priority } from './constants';
import type { ActivityDTO } from './types';

export interface ActivityLookups {
  readonly statusName?: (id: string) => string | undefined;
  readonly personName?: (id: string) => string | undefined;
  readonly labelName?: (id: string) => string | undefined;
  readonly sectionName?: (id: string) => string | undefined;
  /** The person reading the feed: "assigned this to you" instead of their own name. */
  readonly viewerId?: string;
  /** Programs: a variant's name, and the program's unit words ("kits"). */
  readonly variantName?: (id: string) => string | undefined;
  readonly unit?: { readonly singular: string; readonly plural: string };
}

const FIELD_WORDS: Readonly<Record<string, string>> = {
  title: 'renamed this',
  description: 'updated the description',
  start_date: 'changed the start date',
  due_date: 'changed the due date',
  estimate_points: 'changed the estimate',
  estimate_minutes: 'changed the time estimate',
  milestone: 'changed the milestone',
  is_milestone: 'changed the milestone setting',
  recurrence: 'changed how this repeats',
  section: 'moved this to another section',
  reporter: 'changed the reporter',
};

const str = (value: unknown): string | undefined => (typeof value === 'string' ? undash(value) : undefined);
const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {});

export function describeActivity(event: ActivityDTO, lookups: ActivityLookups = {}): string {
  const meta = event.meta ?? {};
  switch (event.verb) {
    case 'task.created':
      if (meta.formName) return `sent this in with the form “${String(meta.formName)}”`;
      if (meta.recurringFrom) return 'created the next repeat of this task';
      if (meta.duplicatedFrom) return 'made this as a copy';
      return 'created this task';
    case 'task.updated': {
      if (event.field === 'status') {
        const to = str(meta.toName) ?? (str(event.after) ? lookups.statusName?.(event.after as string) : undefined);
        return to ? `moved this to ${to}` : 'changed the status';
      }
      if (event.field === 'assignee') {
        const to = str(event.after);
        if (!to) return 'unassigned this';
        if (event.actorId && to === event.actorId) return 'assigned this to themselves';
        if (lookups.viewerId && to === lookups.viewerId) return 'assigned this to you';
        return `assigned this to ${lookups.personName?.(to) ?? 'a teammate'}`;
      }
      if (event.field === 'priority') {
        const to = str(event.after) as Priority | undefined;
        return to ? `set the priority to ${PRIORITY_LABELS[to].toLowerCase()}` : 'changed the priority';
      }
      if (event.field === 'title' && str(event.after)) return `renamed this to “${event.after as string}”`;
      if (event.field === 'due_date') return str(event.after) ? `set the due date to ${event.after as string}` : 'removed the due date';
      if (event.field?.startsWith('custom:')) return 'updated a custom field';
      return FIELD_WORDS[event.field ?? ''] ?? 'updated this task';
    }
    case 'task.moved': {
      const before = record(event.before);
      const after = record(event.after);
      if ((before.parentTaskId ?? null) !== (after.parentTaskId ?? null)) {
        return after.parentTaskId ? 'made this a subtask' : 'made this a top-level task';
      }
      const direction = str(after.direction) ?? (str(after.position) && str(before.position) ? ((after.position as string) < (before.position as string) ? 'up' : 'down') : undefined);
      const where = str(after.statusName);
      if (!direction) return 'changed the order';
      return where ? `moved this ${direction} in ${where}` : `moved this ${direction} in the order`;
    }
    case 'task.moved_project':
      return `moved this to ${str(record(event.after).key) ?? 'another project'}`;
    case 'task.deleted':
      return `deleted ${str(record(event.before).key) ?? 'a task'}`;
    case 'task.restored':
      return 'restored this task';
    case 'task.label_added':
      return `added the label ${lookups.labelName?.(String(event.after)) ?? ''}`.trim();
    case 'task.label_removed':
      return `removed the label ${lookups.labelName?.(String(event.before)) ?? ''}`.trim();
    case 'task.dependency_added':
      return record(event.after).blockedBy ? `said this waits on ${str(record(event.after).key) ?? 'another task'}` : `said this blocks ${str(record(event.after).key) ?? 'another task'}`;
    case 'task.dependency_removed':
      return 'removed a dependency';
    case 'task.link_added':
      return `linked ${str(record(event.after).title) ?? 'a record'}`;
    case 'task.link_removed':
      return `unlinked ${str(record(event.before).title) ?? 'a record'}`;
    case 'comment.added':
      return 'commented';
    case 'comment.edited':
      return 'edited a comment';
    case 'comment.deleted':
      return 'deleted a comment';
    case 'attachment.added':
      return `attached ${str(record(event.after).name) ?? 'a file'}`;
    case 'attachment.deleted':
      return `removed ${str(record(event.before).name) ?? 'a file'}`;
    case 'time.logged': {
      const minutes = Number(record(event.after).minutes ?? 0);
      const h = Math.floor(minutes / 60);
      const m = minutes % 60;
      return `logged ${[h ? `${h}h` : '', m || !h ? `${m}m` : ''].filter(Boolean).join(' ')}`;
    }
    case 'automation.ran':
      // The actor already reads "Automation", so don't repeat the word.
      return `ran the rule “${str(meta.name) ?? 'Untitled'}”`;
    case 'project.created':
      return 'created this project';
    case 'template.used': {
      const name = str(meta.template)?.replace(/\s+template$/i, '').trim();
      return name ? `created this project from the ${name} template` : 'created this project from a template';
    }
    case 'project.updated':
      if (event.field === 'health') return `marked the project ${String(event.after).replace('_', ' ')}`;
      if (event.field === 'healthNote') return 'updated the status note';
      if (event.field === 'status') return 'changed the project stage';
      if (event.field === 'description') return 'updated the project description';
      if (event.field === 'dueDate' || event.field === 'startDate') return 'changed the project dates';
      if (event.field === 'ownerId') return 'changed the project owner';
      if (event.field === 'spaceId') return 'moved the project to another space';
      return `updated the project ${event.field ?? ''}`.trim();
    case 'project.archived':
      return 'archived this project';
    case 'project.restored':
      return 'restored this project';
    case 'project.member_added':
      return `added ${lookups.personName?.(String(record(event.after).userId)) ?? 'someone'} to the project`;
    case 'project.member_removed':
      return `removed ${lookups.personName?.(String(record(event.before).userId)) ?? 'someone'} from the project`;
    case 'project.member_updated':
      return `changed ${lookups.personName?.(String(record(event.after).userId)) ?? 'someone'}'s role`;
    case 'form.submitted':
      return 'received a form response';
    case 'project.update_posted': {
      const health = String(record(event.after).health ?? 'on_track');
      return `posted a status update: ${health === 'off_track' ? 'off track' : health === 'at_risk' ? 'at risk' : 'on track'}`;
    }
    case 'goal.checked_in':
      return 'checked in on a goal';
    case 'status.created':
      return `added the “${str(record(event.after).name) ?? 'new'}” column`;
    case 'status.updated':
      return `changed the “${str(record(event.after).name) ?? str(record(event.before).name) ?? ''}” column`;
    case 'status.deleted':
      return `removed the “${str(record(event.before).name) ?? ''}” column`;
    case 'section.created':
      return `added the section “${str(record(event.after).name) ?? ''}”`;
    case 'section.updated':
      return `renamed a section to “${str(record(event.after).name) ?? ''}”`;
    case 'section.deleted':
      return `removed the section “${str(record(event.before).name) ?? ''}”`;
    case 'label.created':
      return `added the label “${str(record(event.after).name) ?? ''}”`;
    case 'label.updated':
      return `changed the label “${str(record(event.after).name) ?? ''}”`;
    case 'label.deleted':
      return `removed the label “${str(record(event.before).name) ?? ''}”`;
    case 'field.created':
      return `added the custom field “${str(record(event.after).name) ?? ''}”`;
    case 'field.updated':
      return `changed the custom field “${str(record(event.after).name) ?? ''}”`;
    case 'field.deleted':
      return `removed the custom field “${str(record(event.before).name) ?? ''}”`;
    case 'milestone.created':
      return `added the milestone “${str(record(event.after).name) ?? ''}”`;
    case 'milestone.updated':
      return `updated the milestone “${str(record(event.after).name) ?? str(record(event.before).name) ?? ''}”`;
    case 'milestone.reached':
      return `reached the milestone “${str(record(event.after).name) ?? ''}”`;
    case 'milestone.deleted':
      return `removed the milestone “${str(record(event.before).name) ?? ''}”`;
    case 'cycle.created':
      return `planned ${str(record(event.after).name) ?? 'a cycle'}`;
    case 'cycle.updated':
      return `updated ${str(record(event.after).name) ?? 'a cycle'}`;
    case 'cycle.completed': {
      const moved = Number(meta.rolledOver ?? 0);
      return `closed ${str(record(event.after).name) ?? 'a cycle'}${moved ? ` and moved ${moved} unfinished ${moved === 1 ? 'task' : 'tasks'} on` : ''}`;
    }
    case 'cycle.deleted':
      return `removed ${str(record(event.before).name) ?? 'a cycle'}`;
    case 'task.cycle_changed':
      return str(record(event.after).name) ? `added this to ${str(record(event.after).name)}` : `took this out of ${str(record(event.before).name) ?? 'its cycle'}`;
    case 'triage.added':
      return `sent in the request “${str(record(event.after).title) ?? ''}”`;
    case 'triage.accepted':
      return 'accepted this from Triage';
    case 'triage.merged':
      return `merged the request “${str(record(event.before).title) ?? ''}” into this`;
    case 'triage.declined':
      return `declined the request “${str(record(event.before).title) ?? ''}”`;
    default:
      return describeProgramActivity(event, lookups) ?? event.verb.replace(/[._]/g, ' ');
  }
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function shortDay(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(value)) return undefined;
  const [, m, d] = value.slice(0, 10).split('-').map(Number) as [number, number, number];
  return `${MONTHS[m - 1]!.slice(0, 3)} ${d}`;
}

function monthWord(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}/.test(value)) return undefined;
  return MONTHS[Number(value.slice(5, 7)) - 1];
}

function qtyWords(value: unknown, unit: ActivityLookups['unit']): string {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value) : '0';
  const n = text.includes('.') ? text.replace(/\.?0+$/, '') : text;
  const words = unit ?? { singular: 'unit', plural: 'units' };
  return `${Number(n).toLocaleString('en-US')} ${n === '1' ? words.singular : words.plural}`;
}

function centsWords(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) return undefined;
  const negative = value.startsWith('-');
  const digits = (negative ? value.slice(1) : value).padStart(3, '0');
  const dollars = Number(digits.slice(0, -2)).toLocaleString('en-US');
  return `${negative ? '-' : ''}$${dollars}.${digits.slice(-2)}`;
}

function priceWords(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d+(\.\d+)?$/.test(value)) return undefined;
  const [whole, frac = ''] = value.split('.');
  const cents = (frac + '00').slice(0, 4).replace(/0{1,2}$/, '');
  return `$${Number(whole).toLocaleString('en-US')}.${cents.length < 2 ? cents.padEnd(2, '0') : cents}`;
}

/**
 * Program verbs (docs/programs/SPEC.md 4.10). Money appears only when the row still carries a
 * `money` key (the server strips it for readers without money access), so every sentence has a
 * units only form ("changed the XL Brown rate").
 */
export function describeProgramActivity(event: ActivityDTO, lookups: ActivityLookups = {}): string | null {
  const before = record(event.before);
  const after = record(event.after);
  const money = record(after.money);
  const variant = (id: unknown) => (typeof id === 'string' ? lookups.variantName?.(id) : undefined);
  switch (event.verb) {
    case 'program.created':
      return 'created this program';
    case 'program.updated':
      if (event.field === 'setup') return 'set up variants, prices and the schedule';
      if (event.field === 'template') return `saved this program as the template “${str(after.name) ?? 'Untitled'}”`;
      return 'updated the program';
    case 'program.status_changed': {
      const status = str(after.status);
      if (status === 'on_hold') return 'paused this program';
      if (status === 'completed') return shortDay(after.endsOn) ? `ended this program on ${shortDay(after.endsOn)}` : 'ended this program';
      return 'resumed this program';
    }
    case 'program.archived':
      return 'archived this program';
    case 'program.restored':
      return 'restored this program';
    case 'program.deleted':
      return 'deleted this program';
    case 'program.copied':
      return `made this program as a copy of ${str(after.from) ?? 'another program'}`;
    case 'program.settings_changed':
      return 'changed the program settings';
    case 'program.month_closed':
      return centsWords(money.totalCents) ? `closed ${monthWord(after.month) ?? 'the month'} at ${centsWords(money.totalCents)}` : `closed ${monthWord(after.month) ?? 'the month'}`;
    case 'program.month_reopened':
      return `reopened ${monthWord(after.month) ?? 'the month'}${str(after.reason) ? `: ${str(after.reason)}` : ''}`;
    case 'variant.created':
      return typeof after.count === 'number' && after.count > 1 ? `added ${after.count} variants` : 'added a variant';
    case 'variant.updated':
      return str(after.name) ? `updated the variant ${str(after.name)}` : 'updated a variant';
    case 'variant.retired':
      return `retired the variant ${str(after.name) ?? ''}`.trim();
    case 'variant.restored':
      return `brought back the variant ${str(after.name) ?? ''}`.trim();
    case 'variant.deleted':
      return `deleted the variant ${str(before.name) ?? ''}`.trim();
    case 'variant.kit_linked':
      return 'linked a kit to a variant';
    case 'attributes.changed':
      return 'changed the variant attributes';
    case 'price_card.draft_created':
      return shortDay(after.effectiveFrom) ? `started a price card draft for ${shortDay(after.effectiveFrom)}` : 'started a price card draft';
    case 'price_card.version_published': {
      const start = shortDay(after.effectiveFrom);
      const words = `published price card v${typeof after.number === 'number' ? after.number : ''}${start ? ` starting ${start}` : ''}`;
      return str(money.summary) ? `${words} (${str(money.summary)})` : words;
    }
    case 'price_card.version_replaced':
      return 'replaced a price card version that started the same day';
    case 'price_card.unpublished':
      return `moved price card v${typeof after.number === 'number' ? after.number : ''} back to a draft`;
    case 'price_card.version_deleted':
      return 'deleted a price card version';
    case 'price_card.variant_rate_changed': {
      const rates = Array.isArray(money.rates) ? (money.rates as { variantId?: string; unitPrice?: string | null }[]) : [];
      const one = rates.length === 1 ? rates[0] : undefined;
      const name = one ? variant(one.variantId) : undefined;
      if (one && name && priceWords(one.unitPrice)) return `changed the ${name} rate to ${priceWords(one.unitPrice)}`;
      if (name) return `changed the ${name} rate`;
      return typeof after.variants === 'number' && after.variants > 1 ? `changed ${after.variants} variant rates` : 'changed a variant rate';
    }
    case 'price_card.review_requested':
      return 'asked for a price card review';
    case 'price_card.sent_back':
      return str(after.note) ? `sent back the price card draft: ${str(after.note)}` : 'sent back the price card draft';
    case 'one_time.added': {
      const amount = centsWords(money.amountCents);
      const label = str(after.label) ?? (after.kind === 'setup' ? 'a setup fee' : 'an adjustment');
      return amount ? `added ${label} of ${amount}` : `added ${label}`;
    }
    case 'one_time.updated':
      return 'changed a charge';
    case 'one_time.deleted':
      return `removed ${str(before.label) ?? 'a charge'}`;
    case 'build.planned':
      return typeof after.count === 'number' ? `planned ${after.count} builds` : 'planned builds';
    case 'build.updated':
      if (event.field === 'planned_qty') return `changed the planned qty to ${qtyWords(event.after, lookups.unit)}`;
      if (event.field === 'build_date') return shortDay(event.after) ? `moved this build to ${shortDay(event.after)}` : 'moved this build';
      if (event.field === 'variant') return variant(event.after) ? `changed the variant to ${variant(event.after)}` : 'changed the variant';
      if (typeof after.undone === 'number') return `undid ${after.undone} new builds`;
      return 'updated this build';
    case 'build.moved':
      return `moved this build to ${str(after.key)?.split('-')[0] ?? 'another place'}`;
    case 'build.split':
      return `moved ${qtyWords(after.qty, lookups.unit)} to ${shortDay(after.toDate) ?? 'another day'}`;
    case 'build.closed_short':
      return str(after.reason) ? `closed this build short: ${str(after.reason)}` : 'closed this build short';
    case 'build.rate_override_set': {
      const rate = priceWords(money.rateOverride);
      if (event.after && !rate && !('money' in after)) return 'changed the build rate';
      return rate ? `set the build rate to ${rate}` : 'cleared the build rate';
    }
    case 'build.output_logged': {
      const name = variant(after.variant);
      const day = shortDay(after.date);
      const revenue = centsWords(money.revenueCents);
      return `logged ${qtyWords(after.qty, lookups.unit)}${name ? ` on ${name}` : ''}${day ? ` for ${day}` : ''}${revenue ? ` (${revenue})` : ''}`;
    }
    case 'build.output_deleted':
      return `removed the output for ${shortDay(before.date) ?? 'a day'}`;
    case 'build.repriced':
      return typeof after.rows === 'number' ? `updated prices on ${after.rows} open ${after.rows === 1 ? 'day' : 'days'}` : 'updated prices on open days';
    case 'run.moved':
      return shortDay(after.toDate) ? `moved a run to ${shortDay(after.toDate)}` : 'moved a run';
    case 'run.cancelled':
      return 'cancelled a run';
    case 'run.copied':
      return 'copied a run';
    case 'run.closed':
      return 'closed a run';
    case 'schedule.created':
      return `added the schedule ${str(after.name) ?? ''}`.trim();
    case 'schedule.updated':
      return shortDay(after.skipped) ? `skipped ${shortDay(after.skipped)} on a schedule` : `updated the schedule ${str(after.name) ?? ''}`.trim();
    case 'schedule.paused':
      return `paused the schedule ${str(after.name) ?? ''}`.trim();
    case 'schedule.resumed':
      return `resumed the schedule ${str(after.name) ?? ''}`.trim();
    case 'schedule.ended':
      return `ended the schedule ${str(after.name) ?? ''}`.trim();
    case 'schedule.generated':
      return typeof after.count === 'number' ? `planned ${after.count} ${after.count === 1 ? 'build' : 'builds'} from ${str(after.name) ?? 'a schedule'}` : 'planned builds from a schedule';
    case 'link.added':
      return 'added a link';
    case 'link.removed':
      return 'removed a link';
    case 'program.pulse_job_linked':
      return str(after.number) ? `linked the Pulse job ${str(after.number)}` : 'linked a Pulse job';
    case 'program.pulse_job_unlinked':
      return 'removed the Pulse job link';
    case 'calendar.updated':
      return 'updated the work calendar';
    default:
      return null;
  }
}

export interface ActivityParts {
  /** Words before the task link ("created", "moved", "commented on"). */
  readonly before: string;
  /** Words after it ("to Done"); empty when the sentence ends with the task. */
  readonly after: string;
}

/**
 * Project-scope wording, where the task is named by a link: "created OPS-14 Write the…",
 * "moved OPS-14 … to Done", "commented on OPS-14 …". Slot the link between `before` and
 * `after`. Automation rows (actor shown as "Automation") read "ran “Rule” on OPS-14 …".
 */
export function describeActivityParts(event: ActivityDTO, lookups: ActivityLookups = {}): ActivityParts {
  const meta = event.meta ?? {};
  if (event.verb === 'automation.ran') return { before: `ran “${str(meta.name) ?? 'a rule'}” on`, after: '' };
  if (event.verb === 'task.created') {
    if (meta.formName) return { before: 'sent in', after: `with the form “${String(meta.formName)}”` };
    if (meta.recurringFrom) return { before: 'created the next repeat of', after: '' };
    if (meta.duplicatedFrom) return { before: 'made', after: 'as a copy' };
    return { before: 'created', after: '' };
  }
  if (event.verb === 'task.restored') return { before: 'restored', after: '' };
  const text = describeActivity(event, lookups);
  const match = /\bthis( task)?\b/.exec(text);
  if (match) {
    return { before: text.slice(0, match.index).trimEnd(), after: text.slice(match.index + match[0].length).trimStart() };
  }
  return { before: `${text} on`, after: '' };
}

/** "added the subtask OPS-15 Order labels": a subtask's creation, shown in its parent's history. */
export function describeSubtaskAdded(event: ActivityDTO, projectKey: string): string | null {
  if (event.verb !== 'task.created') return null;
  const after = record(event.after);
  const number = typeof after.number === 'number' ? after.number : null;
  const title = str(after.title);
  const key = number !== null ? `${projectKey}-${number}` : null;
  return `added the subtask ${[key, title].filter(Boolean).join(' ') || 'a subtask'}`;
}
