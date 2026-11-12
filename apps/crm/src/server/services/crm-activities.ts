/**
 * "Log activity": creates an Activities board item linked (connect_boards) to the chosen
 * contacts and deals, and bumps the contacts' "Last contacted" date for completed touches.
 */
import { asc, and, eq, isNull } from 'drizzle-orm';
import { groups } from '@/server/db/schema';
import { BadRequestError, NotFoundError } from '@/server/http/errors';
import { requireBoard } from './access';
import { inTransaction, type ServiceContext } from './context';
import {
  connectColumnTo,
  findColumn,
  labelsOf,
  loadCrmBoard,
  loadItemsByIds,
  readDate,
  resolveCrmBoards,
  statusColumnFor,
} from './crm-boards';
import type { LogActivityInput, LoggedActivityDto } from './crm-contracts';
import { activityIsUpcoming } from './crm-model';
import { finishItemMutation, insertItem, updateItem } from './items';

const OUTCOME_TEXT: Readonly<Record<LogActivityInput['outcome'], string>> = {
  completed: 'Completed',
  connected: 'Connected',
  left_voicemail: 'Left voicemail',
  no_answer: 'No answer',
  scheduled: 'Scheduled',
  cancelled: 'Cancelled',
};

/** Pick the status label for an outcome: done label, cancelled label or the planned label. */
export function statusForOutcome(
  labels: readonly { id: string; name: string; isDone?: boolean; isDefault?: boolean }[],
  outcome: LogActivityInput['outcome'],
  upcoming: boolean,
): string | null {
  const usable = labels.filter((label) => !label.isDefault);
  if (outcome === 'cancelled') return usable.find((label) => /cancel/i.test(label.name))?.id ?? null;
  if (upcoming) return usable.find((label) => !label.isDone && !/cancel/i.test(label.name))?.id ?? null;
  return usable.find((label) => label.isDone)?.id ?? null;
}

async function groupFor(ctx: ServiceContext, boardId: string, upcoming: boolean): Promise<string | undefined> {
  const rows = await ctx.db
    .select({ id: groups.id, title: groups.title })
    .from(groups)
    .where(and(eq(groups.boardId, boardId), eq(groups.orgId, ctx.orgId), isNull(groups.deletedAt), isNull(groups.archivedAt)))
    .orderBy(asc(groups.position));
  const pattern = upcoming ? /upcoming|planned|scheduled|to ?do/i : /complete|done|past|logged/i;
  return rows.find((row) => pattern.test(row.title))?.id ?? rows[0]?.id;
}

export async function logCrmActivity(
  ctx: ServiceContext,
  input: LogActivityInput,
  now = new Date(),
): Promise<LoggedActivityDto> {
  const resolved = await resolveCrmBoards(ctx);
  const board = await loadCrmBoard(ctx, resolved.primary.activities);
  if (!board) throw new NotFoundError('Activities board');
  await requireBoard(ctx, board.row.id, 'write');
  if (input.contactIds.length === 0 && input.dealIds.length === 0) {
    throw new BadRequestError('Link the activity to at least one contact or deal');
  }
  const cols = board.columns;
  const typeColumn = findColumn(cols, ['type', 'activity_type'], 'status');
  const typeLabel = labelsOf(typeColumn).find((label) => label.id === input.typeLabelId && !label.isDefault);
  if (!typeColumn || !typeLabel) throw new BadRequestError('Unknown activity type');
  const statusColumn = statusColumnFor(board.row, cols, ['status']);
  const dateColumn = findColumn(cols, ['date', 'due_date'], 'date');
  const durationColumn = findColumn(cols, ['duration'], 'number');
  const ownerColumn = findColumn(cols, ['owner'], 'people');
  const notesColumn = findColumn(cols, ['notes', 'description'], ['long_text', 'text']);
  const dealColumn = connectColumnTo(cols, resolved.primary.deals?.id, ['deal', 'deals']);
  const contactColumn = connectColumnTo(cols, resolved.primary.contacts?.id, ['contact', 'contacts']);

  // Validate the linked records are what they claim to be (org-scoped, right boards).
  const [contacts, deals] = await Promise.all([
    loadItemsByIds(ctx, input.contactIds, resolved.primary.contacts ? [resolved.primary.contacts.id] : []),
    loadItemsByIds(ctx, input.dealIds, resolved.primary.deals ? [resolved.primary.deals.id] : []),
  ]);
  if (contacts.length !== new Set(input.contactIds).size) throw new BadRequestError('A linked contact was not found');
  if (deals.length !== new Set(input.dealIds).size) throw new BadRequestError('A linked deal was not found');
  if (contacts.length > 0 && !contactColumn) throw new BadRequestError('The Activities board has no Contacts column');
  if (deals.length > 0 && !dealColumn) throw new BadRequestError('The Activities board has no Deals column');

  const upcoming = activityIsUpcoming(input.date, input.outcome, now);
  const statusId = statusColumn ? statusForOutcome(labelsOf(statusColumn), input.outcome, upcoming) : null;
  const who = contacts[0]?.name ?? deals[0]?.name ?? '';
  const subject = input.subject?.trim() || `${typeLabel.name}${who ? ` with ${who}` : ''}`;
  const outcomeLine = ['completed', 'scheduled'].includes(input.outcome) ? null : `Outcome: ${OUTCOME_TEXT[input.outcome]}`;
  const notes = [outcomeLine, input.notes?.trim()].filter(Boolean).join('\n\n');
  const dealIds = dealColumn && (dealColumn.settings as { allowMultiple?: boolean }).allowMultiple === false ? input.dealIds.slice(0, 1) : input.dealIds;
  const contactIds =
    contactColumn && (contactColumn.settings as { allowMultiple?: boolean }).allowMultiple === false
      ? input.contactIds.slice(0, 1)
      : input.contactIds;

  const values: Record<string, unknown> = {
    [typeColumn.key]: { labelId: typeLabel.id },
    ...(statusColumn && statusId && { [statusColumn.key]: { labelId: statusId } }),
    ...(dateColumn && { [dateColumn.key]: { date: input.date, ...(input.time && { time: input.time }) } }),
    ...(durationColumn && input.durationMinutes !== undefined && { [durationColumn.key]: input.durationMinutes }),
    ...(ownerColumn && ctx.userId && { [ownerColumn.key]: { ids: [ctx.userId] } }),
    ...(notesColumn && notes && { [notesColumn.key]: notes }),
    ...(dealColumn && dealIds.length > 0 && { [dealColumn.key]: { itemIds: dealIds } }),
    ...(contactColumn && contactIds.length > 0 && { [contactColumn.key]: { itemIds: contactIds } }),
  };

  const created = await inTransaction(ctx, async (tx) => {
    const groupId = await groupFor(tx, board.row.id, upcoming);
    const { row, events } = await insertItem(tx, board.row, board.columns, {
      name: subject,
      groupId,
      values: values as never,
      position: 'top',
    });
    await finishItemMutation(tx, board.row, [row.id], events);
    return row;
  });

  // Last contacted: completed touches move the contact's date forward (never backwards).
  const updatedContactIds: string[] = [];
  if (!upcoming && input.outcome !== 'cancelled' && resolved.primary.contacts) {
    const contactsBoard = await loadCrmBoard(ctx, resolved.primary.contacts);
    const lastColumn = contactsBoard ? findColumn(contactsBoard.columns, ['last_contacted', 'last_activity'], 'date') : undefined;
    if (contactsBoard && lastColumn) {
      const writable = await requireBoard(ctx, contactsBoard.row.id, 'write').then(
        () => true,
        () => false,
      );
      for (const contact of writable ? contacts : []) {
        const current = readDate(contact.values, lastColumn);
        if (current && current >= input.date) continue;
        await updateItem(ctx, contact.id, { values: { [lastColumn.key]: { date: input.date } } as never });
        updatedContactIds.push(contact.id);
      }
    }
  }
  return { id: created.id, boardId: board.row.id, name: created.name, upcoming, updatedContactIds };
}
