/**
 * Contact 360 and Account 360: profile, linked deals with totals, related contacts, a merged
 * activity timeline (Activities board items + updates) and next steps. Relations are read
 * through `item_links` in both directions, so links created from either side show up.
 */
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { boards, itemLinks, items, updates, user } from '@/server/db/schema';
import { NotFoundError } from '@/server/http/errors';
import { requireBoard, requireItem, visibleBoardsPredicate, type BoardRow, type ItemRow } from './access';
import type { ServiceContext } from './context';
import {
  currencyOf,
  findColumn,
  labelDto,
  labelsOf,
  loadBoardRows,
  loadCrmBoard,
  loadItemsByIds,
  orgUsers,
  readAmount,
  readConnect,
  readDate,
  readDomain,
  readEmail,
  readLabelId,
  readLabelIds,
  readPeople,
  readPhone,
  readText,
  readTime,
  readUrl,
  resolveCrmBoards,
  statusColumnFor,
  toRef,
  type CrmBoard,
} from './crm-boards';
import type {
  Account360Dto,
  ActivityOptionsDto,
  Contact360Dto,
  ContactRowDto,
  CrmBoardRefDto,
  CrmLabelDto,
  CrmRecordRowDto,
  CrmRecordsDto,
  CrmUserDto,
  DealRowDto,
  DealTotalsDto,
  NextStepDto,
  ProfileFieldDto,
  RecordRefDto,
  TimelineEntryDto,
  TimelineKind,
} from './crm-contracts';
import { dealColumns, dealStages } from './crm-pipeline';
import type { ColumnRow } from './item-reads';

const TIMELINE_LIMIT = 80;

interface Neighbor {
  readonly item: ItemRow;
  readonly board: BoardRow;
}

/** Items linked to any of `ids` (either direction), on boards the caller can see. */
async function neighbors(ctx: ServiceContext, ids: readonly string[]): Promise<Neighbor[]> {
  if (ids.length === 0) return [];
  const list = [...new Set(ids)];
  const links = await ctx.db
    .select({ from: itemLinks.fromItemId, to: itemLinks.toItemId })
    .from(itemLinks)
    .where(and(eq(itemLinks.orgId, ctx.orgId), or(inArray(itemLinks.fromItemId, list), inArray(itemLinks.toItemId, list))));
  const other = new Set<string>();
  for (const link of links) {
    if (list.includes(link.from)) other.add(link.to);
    if (list.includes(link.to)) other.add(link.from);
  }
  for (const id of list) other.delete(id);
  if (other.size === 0) return [];
  const rows = await ctx.db
    .select({ item: items, board: boards })
    .from(items)
    .innerJoin(boards, eq(boards.id, items.boardId))
    .where(
      and(
        eq(items.orgId, ctx.orgId),
        inArray(items.id, [...other]),
        isNull(items.deletedAt),
        isNull(items.archivedAt),
        visibleBoardsPredicate(ctx),
      ),
    );
  return rows;
}

async function columnsByBoard(ctx: ServiceContext, rows: readonly Neighbor[]): Promise<Map<string, CrmBoard>> {
  const result = new Map<string, CrmBoard>();
  for (const { board } of rows) {
    if (result.has(board.id)) continue;
    const loaded = await loadCrmBoard(ctx, toRef(board, 0));
    if (loaded) result.set(board.id, loaded);
  }
  return result;
}

function person(users: ReadonlyMap<string, CrmUserDto>, ids: readonly string[]): CrmUserDto | null {
  for (const id of ids) {
    const found = users.get(id);
    if (found) return found;
  }
  return null;
}

function dealRows(
  dealNeighbors: readonly Neighbor[],
  boardsById: ReadonlyMap<string, CrmBoard>,
  users: ReadonlyMap<string, CrmUserDto>,
): { rows: DealRowDto[]; totals: DealTotalsDto; currency: string; nextSteps: NextStepDto[] } {
  const rows: DealRowDto[] = [];
  const nextSteps: NextStepDto[] = [];
  let currency = 'USD';
  let weighted = 0;
  const byBoard = new Map<string, Neighbor[]>();
  for (const entry of dealNeighbors) byBoard.set(entry.board.id, [...(byBoard.get(entry.board.id) ?? []), entry]);
  for (const [boardId, entries] of byBoard) {
    const board = boardsById.get(boardId);
    if (!board) continue;
    const cols = dealColumns(board);
    currency = currencyOf(cols.value);
    const { stages } = dealStages(board, cols, entries.map((entry) => entry.item));
    const stageById = new Map(stages.map((stage) => [stage.label.id, stage]));
    for (const { item } of entries) {
      const stageId = readLabelId(item.values, cols.stage);
      const stage = stageId ? stageById.get(stageId) : undefined;
      const value = readAmount(item.values, cols.value);
      const kind = stage?.kind ?? 'open';
      if (kind === 'open') weighted += (value * (stage?.probability ?? 0)) / 100;
      const closeDate = readDate(item.values, cols.closeDate);
      rows.push({
        id: item.id,
        name: item.name,
        boardId,
        stage: stage?.label ?? labelDto(cols.stage, stageId),
        stageKind: kind,
        value,
        closeDate,
        owner: person(users, readPeople(item.values, cols.owner)),
      });
      const step = readText(item.values, cols.nextStep);
      if (step && kind === 'open') {
        nextSteps.push({
          id: `deal:${item.id}`,
          kind: 'deal',
          title: `${step} · ${item.name}`,
          due: closeDate,
          overdue: closeDate !== null && closeDate < new Date().toISOString().slice(0, 10),
          itemId: item.id,
          boardId,
        });
      }
    }
  }
  const order = { open: 0, won: 1, lost: 2 } as const;
  rows.sort((a, b) => order[a.stageKind] - order[b.stageKind] || b.value - a.value);
  const open = rows.filter((row) => row.stageKind === 'open');
  return {
    rows,
    currency,
    nextSteps,
    totals: {
      count: rows.length,
      openCount: open.length,
      openValue: open.reduce((sum, row) => sum + row.value, 0),
      wonValue: rows.filter((row) => row.stageKind === 'won').reduce((sum, row) => sum + row.value, 0),
      weighted: Math.round(weighted),
    },
  };
}

function contactRow(item: ItemRow, columns: readonly ColumnRow[]): ContactRowDto {
  return {
    id: item.id,
    name: item.name,
    boardId: item.boardId,
    email: readEmail(item.values, findColumn(columns, ['email'], 'email')),
    phone: readPhone(item.values, findColumn(columns, ['phone'], 'phone')),
    title: readText(item.values, findColumn(columns, ['job_title', 'title'], 'text')),
    lastContacted: readDate(item.values, findColumn(columns, ['last_contacted'], 'date')),
  };
}

export function timelineKind(label: CrmLabelDto | null): TimelineKind {
  const text = `${label?.id ?? ''} ${label?.name ?? ''}`.toLowerCase();
  for (const kind of ['call', 'email', 'meeting', 'demo', 'task', 'note'] as const) if (text.includes(kind)) return kind;
  return 'other';
}

function activityEntries(
  activityNeighbors: readonly Neighbor[],
  boardsById: ReadonlyMap<string, CrmBoard>,
  users: ReadonlyMap<string, CrmUserDto>,
  names: ReadonlyMap<string, RecordRefDto>,
  todayIso: string,
): { entries: TimelineEntryDto[]; nextSteps: NextStepDto[] } {
  const entries: TimelineEntryDto[] = [];
  const nextSteps: NextStepDto[] = [];
  for (const { item, board } of activityNeighbors) {
    const cols = boardsById.get(board.id)?.columns ?? [];
    const typeColumn = findColumn(cols, ['type', 'activity_type'], 'status');
    const statusColumn = statusColumnFor(board, cols, ['status']);
    const dateColumn = findColumn(cols, ['date', 'due_date'], 'date');
    const typeLabel = labelDto(typeColumn, readLabelId(item.values, typeColumn));
    const statusLabelId = readLabelId(item.values, statusColumn);
    const status = labelDto(statusColumn, statusLabelId);
    const statusInfo = labelsOf(statusColumn).find((label) => label.id === statusLabelId);
    const date = readDate(item.values, dateColumn);
    const time = readTime(item.values, dateColumn);
    const at = date ? `${date}T${time ?? '12:00'}:00.000Z` : item.createdAt.toISOString();
    const finished = Boolean(statusInfo?.isDone) || /cancel/i.test(statusInfo?.name ?? '');
    const upcoming = !finished && (date ?? '') >= todayIso;
    const related = cols
      .filter((column) => column.type === 'connect_boards')
      .flatMap((column) => readConnect(item.values, column))
      .map((id) => names.get(id))
      .filter((ref): ref is RecordRefDto => Boolean(ref));
    entries.push({
      id: `activity:${item.id}`,
      source: 'activity',
      kind: timelineKind(typeLabel),
      title: item.name,
      body: readText(item.values, findColumn(cols, ['notes', 'description'], ['long_text', 'text'])),
      at,
      author: person(users, readPeople(item.values, findColumn(cols, ['owner'], 'people'))),
      status,
      typeLabel,
      upcoming,
      itemId: item.id,
      boardId: board.id,
      relatedTo: related,
    });
    if (upcoming) {
      nextSteps.push({
        id: `activity:${item.id}`,
        kind: 'activity',
        title: item.name,
        due: date,
        overdue: false,
        itemId: item.id,
        boardId: board.id,
      });
    }
    if (!finished && date && date < todayIso && !/cancel/i.test(status?.name ?? '')) {
      nextSteps.push({
        id: `activity:${item.id}`,
        kind: 'activity',
        title: item.name,
        due: date,
        overdue: true,
        itemId: item.id,
        boardId: board.id,
      });
    }
  }
  return { entries, nextSteps };
}

async function updateEntries(
  ctx: ServiceContext,
  itemIds: readonly string[],
  names: ReadonlyMap<string, RecordRefDto>,
): Promise<TimelineEntryDto[]> {
  if (itemIds.length === 0) return [];
  const rows = await ctx.db
    .select({
      id: updates.id,
      itemId: updates.itemId,
      boardId: updates.boardId,
      bodyText: updates.bodyText,
      createdAt: updates.createdAt,
      authorId: updates.authorId,
      authorName: user.name,
      authorImage: user.image,
    })
    .from(updates)
    .leftJoin(user, eq(user.id, updates.authorId))
    .where(
      and(
        eq(updates.orgId, ctx.orgId),
        inArray(updates.itemId, [...itemIds]),
        isNull(updates.parentUpdateId),
        isNull(updates.deletedAt),
      ),
    )
    .orderBy(desc(updates.createdAt))
    .limit(TIMELINE_LIMIT);
  return rows.map((row) => {
    const ref = names.get(row.itemId);
    return {
      id: `update:${row.id}`,
      source: 'update' as const,
      kind: 'update' as const,
      title: ref ? `Update on ${ref.name}` : 'Update',
      body: row.bodyText || null,
      at: row.createdAt.toISOString(),
      author: row.authorId ? { id: row.authorId, name: row.authorName ?? 'Unknown user', image: row.authorImage } : null,
      status: null,
      typeLabel: null,
      upcoming: false,
      itemId: row.itemId,
      boardId: row.boardId,
      relatedTo: ref ? [ref] : [],
    };
  });
}

function dedupeSteps(steps: readonly NextStepDto[]): NextStepDto[] {
  const seen = new Set<string>();
  return [...steps]
    .filter((step) => (seen.has(step.id) ? false : (seen.add(step.id), true)))
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.due ?? '9999').localeCompare(b.due ?? '9999'))
    .slice(0, 12);
}

interface LoadedRecord {
  readonly item: ItemRow;
  readonly board: CrmBoard;
  readonly canEdit: boolean;
}

async function loadRecord(ctx: ServiceContext, itemId: string, kind: 'contacts' | 'accounts'): Promise<LoadedRecord> {
  const { item, board } = await requireItem(ctx, itemId, 'read');
  if (board.kind !== kind || item.parentItemId) throw new NotFoundError(kind === 'contacts' ? 'Contact' : 'Account');
  const loaded = await loadCrmBoard(ctx, toRef(board, 0));
  if (!loaded) throw new NotFoundError('Board');
  const canEdit = await requireBoard(ctx, board.id, 'write').then(
    () => true,
    () => false,
  );
  return { item, board: loaded, canEdit };
}

async function activityContext(ctx: ServiceContext) {
  const resolved = await resolveCrmBoards(ctx);
  const activityBoard = await loadCrmBoard(ctx, resolved.primary.activities);
  const typeColumn = activityBoard ? findColumn(activityBoard.columns, ['type', 'activity_type'], 'status') : undefined;
  const activityTypes = labelsOf(typeColumn)
    .filter((label) => !label.isDefault)
    .sort((a, b) => a.position - b.position)
    .map((label) => ({ id: label.id, name: label.name, color: label.color }));
  let activityRef: CrmBoardRefDto | null = activityBoard?.ref ?? null;
  if (activityBoard) {
    const writable = await requireBoard(ctx, activityBoard.row.id, 'write').then(
      () => true,
      () => false,
    );
    if (!writable) activityRef = null;
  }
  return { activityRef, activityTypes };
}

/** Shared assembly: deals, contacts, timeline, next steps around a set of anchor items. */
async function assemble(
  ctx: ServiceContext,
  record: LoadedRecord,
  anchorNeighbors: readonly Neighbor[],
) {
  const dealNeighbors = anchorNeighbors.filter((entry) => entry.board.kind === 'deals');
  const contactNeighbors = anchorNeighbors.filter((entry) => entry.board.kind === 'contacts');
  const names = new Map<string, RecordRefDto>(
    [...dealNeighbors, ...contactNeighbors, { item: record.item, board: record.board.row }].map(({ item }) => [
      item.id,
      { id: item.id, name: item.name, boardId: item.boardId },
    ]),
  );
  // Independent reads run concurrently (pooled connections) instead of one after another.
  const [users, second, { activityRef, activityTypes }, updateRows] = await Promise.all([
    orgUsers(ctx),
    neighbors(ctx, [record.item.id, ...dealNeighbors.map((entry) => entry.item.id), ...contactNeighbors.map((entry) => entry.item.id)]),
    activityContext(ctx),
    updateEntries(ctx, [record.item.id, ...dealNeighbors.map((entry) => entry.item.id)], names),
  ]);
  const activityNeighbors = [...new Map(second.filter((entry) => entry.board.kind === 'activities').map((entry) => [entry.item.id, entry])).values()];
  const boardsById = await columnsByBoard(ctx, [...dealNeighbors, ...contactNeighbors, ...activityNeighbors]);
  const deals = dealRows(dealNeighbors, boardsById, users);
  const todayIso = new Date().toISOString().slice(0, 10);
  const activities = activityEntries(activityNeighbors, boardsById, users, names, todayIso);
  const timeline = [...activities.entries, ...updateRows]
    .sort((a, b) => Number(b.upcoming) - Number(a.upcoming) || (a.upcoming ? a.at.localeCompare(b.at) : b.at.localeCompare(a.at)))
    .slice(0, TIMELINE_LIMIT);
  return {
    users,
    deals,
    contactNeighbors,
    boardsById,
    timeline,
    nextSteps: dedupeSteps([...activities.nextSteps, ...deals.nextSteps]),
    activityRef,
    activityTypes,
  };
}

function tagLabels(item: ItemRow, columns: readonly ColumnRow[], keys: readonly string[]): CrmLabelDto[] {
  const tags: CrmLabelDto[] = [];
  for (const key of keys) {
    const column = columns.find((entry) => entry.key === key && entry.scope === 'item');
    if (!column) continue;
    if (column.type === 'status') {
      const label = labelDto(column, readLabelId(item.values, column));
      if (label) tags.push(label);
    } else if (column.type === 'dropdown') {
      for (const id of readLabelIds(item.values, column)) {
        const label = labelDto(column, id);
        if (label) tags.push(label);
      }
    }
  }
  return tags;
}

function profileFields(
  item: ItemRow,
  columns: readonly ColumnRow[],
  skip: ReadonlySet<string>,
  users: ReadonlyMap<string, CrmUserDto>,
): ProfileFieldDto[] {
  const fields: ProfileFieldDto[] = [];
  for (const column of columns) {
    if (column.scope !== 'item' || column.hidden || skip.has(column.key)) continue;
    const value = item.values[column.key];
    if (value === undefined || value === null) continue;
    const base = { key: column.key, label: column.title };
    switch (column.type) {
      case 'status': {
        const pill = labelDto(column, readLabelId(item.values, column));
        if (pill) fields.push({ ...base, value: pill.name, pill });
        break;
      }
      case 'dropdown': {
        const names = readLabelIds(item.values, column)
          .map((id) => labelDto(column, id)?.name)
          .filter(Boolean);
        if (names.length > 0) fields.push({ ...base, value: names.join(', ') });
        break;
      }
      case 'currency': {
        const amount = readAmount(item.values, column);
        fields.push({
          ...base,
          value: new Intl.NumberFormat('en-US', { style: 'currency', currency: currencyOf(column), maximumFractionDigits: 0 }).format(amount),
        });
        break;
      }
      case 'number':
        if (typeof value === 'number') fields.push({ ...base, value: String(value) });
        break;
      case 'date': {
        const date = readDate(item.values, column);
        if (date) fields.push({ ...base, value: date });
        break;
      }
      case 'link': {
        const url = readUrl(item.values, column);
        if (url && /^https?:\/\//i.test(url)) fields.push({ ...base, value: readText(item.values, column) ?? url, href: url });
        break;
      }
      case 'people': {
        const names = readPeople(item.values, column)
          .map((id) => users.get(id)?.name)
          .filter(Boolean);
        if (names.length > 0) fields.push({ ...base, value: names.join(', ') });
        break;
      }
      case 'country': {
        const code = (value as { code?: unknown }).code;
        if (typeof code === 'string') fields.push({ ...base, value: code });
        break;
      }
      case 'text':
      case 'long_text':
      case 'location': {
        const text = readText(item.values, column);
        if (text) fields.push({ ...base, value: text });
        break;
      }
      default:
        break;
    }
  }
  return fields;
}

export async function getContact360(ctx: ServiceContext, itemId: string): Promise<Contact360Dto> {
  const record = await loadRecord(ctx, itemId, 'contacts');
  const { item, board } = record;
  const cols = board.columns;
  const accountColumn = findColumn(cols, ['account', 'company'], 'connect_boards');
  const ownerColumn = findColumn(cols, ['owner', 'contact_owner'], 'people');
  const firstHop = await neighbors(ctx, [item.id]);
  const assembled = await assemble(ctx, record, firstHop);
  const accountNeighbor = firstHop.find(
    (entry) => entry.board.kind === 'accounts' && readConnect(item.values, accountColumn).includes(entry.item.id),
  ) ?? firstHop.find((entry) => entry.board.kind === 'accounts');
  let account: Contact360Dto['account'] = null;
  let relatedContacts: ContactRowDto[] = [];
  if (accountNeighbor) {
    const accountBoard = await loadCrmBoard(ctx, toRef(accountNeighbor.board, 0));
    const website = readUrl(accountNeighbor.item.values, findColumn(accountBoard?.columns ?? [], ['website', 'domain'], 'link'));
    account = { id: accountNeighbor.item.id, name: accountNeighbor.item.name, boardId: accountNeighbor.board.id, website };
    const siblings = (await neighbors(ctx, [accountNeighbor.item.id])).filter(
      (entry) => entry.board.kind === 'contacts' && entry.item.id !== item.id,
    );
    const siblingBoards = await columnsByBoard(ctx, siblings);
    relatedContacts = siblings.map((entry) => contactRow(entry.item, siblingBoards.get(entry.board.id)?.columns ?? []));
  }
  const row = contactRow(item, cols);
  const skip = new Set(['name', 'email', 'phone', 'job_title', 'title', 'last_contacted', ...(accountColumn ? [accountColumn.key] : [])]);
  return {
    kind: 'contacts',
    id: item.id,
    name: item.name,
    board: board.ref,
    canEdit: record.canEdit,
    owners: readPeople(item.values, ownerColumn)
      .map((id) => assembled.users.get(id))
      .filter((entry): entry is CrmUserDto => Boolean(entry)),
    tags: tagLabels(item, cols, ['type', 'lifecycle', 'segment']),
    fields: profileFields(item, cols, skip, assembled.users).filter((field) => !['type', 'owner'].includes(field.key)),
    email: row.email,
    phone: row.phone,
    title: row.title,
    lastContacted: row.lastContacted,
    account,
    relatedContacts,
    deals: assembled.deals.rows,
    dealTotals: assembled.deals.totals,
    currency: assembled.deals.currency,
    timeline: assembled.timeline,
    nextSteps: assembled.nextSteps,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    activityBoard: assembled.activityRef,
    activityTypes: assembled.activityTypes,
  };
}

export async function getAccount360(ctx: ServiceContext, itemId: string): Promise<Account360Dto> {
  const record = await loadRecord(ctx, itemId, 'accounts');
  const { item, board } = record;
  const cols = board.columns;
  const ownerColumn = findColumn(cols, ['owner', 'account_owner'], 'people');
  const websiteColumn = findColumn(cols, ['website', 'domain'], 'link');
  const firstHop = await neighbors(ctx, [item.id]);
  const assembled = await assemble(ctx, record, firstHop);
  const contacts = assembled.contactNeighbors.map((entry) =>
    contactRow(entry.item, assembled.boardsById.get(entry.board.id)?.columns ?? []),
  );
  const skip = new Set(['name', 'website', 'contacts', 'deals', 'pipeline_value']);
  return {
    kind: 'accounts',
    id: item.id,
    name: item.name,
    board: board.ref,
    canEdit: record.canEdit,
    owners: readPeople(item.values, ownerColumn)
      .map((id) => assembled.users.get(id))
      .filter((entry): entry is CrmUserDto => Boolean(entry)),
    tags: tagLabels(item, cols, ['health', 'industry', 'region']),
    fields: profileFields(item, cols, skip, assembled.users).filter(
      (field) => !['owner'].includes(field.key) && !cols.some((column) => column.key === field.key && column.type === 'connect_boards'),
    ),
    website: readUrl(item.values, websiteColumn),
    domain: readDomain(item.values, websiteColumn),
    contacts,
    deals: assembled.deals.rows,
    dealTotals: assembled.deals.totals,
    currency: assembled.deals.currency,
    timeline: assembled.timeline,
    nextSteps: assembled.nextSteps,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    activityBoard: assembled.activityRef,
    activityTypes: assembled.activityTypes,
  };
}

/** Exact-key status/dropdown column (no type fallback: a wrong pill is worse than none). */
function pillColumn(columns: readonly ColumnRow[], keys: readonly string[]): ColumnRow | undefined {
  for (const key of keys) {
    const hit = columns.find((column) => column.scope === 'item' && column.key === key && (column.type === 'status' || column.type === 'dropdown'));
    if (hit) return hit;
  }
  return undefined;
}

function pillLabel(item: ItemRow, column: ColumnRow | undefined): CrmLabelDto | null {
  if (!column) return null;
  if (column.type === 'dropdown') {
    const [first] = readLabelIds(item.values, column);
    return labelDto(column, first ?? null);
  }
  return labelDto(column, readLabelId(item.values, column));
}

/** Flat records list behind the /crm/contacts and /crm/accounts index pages. */
export async function listCrmRecords(ctx: ServiceContext, kind: 'contacts' | 'accounts'): Promise<CrmRecordsDto> {
  const resolved = await resolveCrmBoards(ctx);
  const board = await loadCrmBoard(ctx, resolved.primary[kind]);
  if (!board) return { kind, board: null, rows: [] };
  const [boardItems, users] = await Promise.all([loadBoardRows(ctx, board.row.id), orgUsers(ctx)]);
  const cols = board.columns;
  const ownerColumn = findColumn(cols, kind === 'contacts' ? ['owner', 'contact_owner'] : ['owner', 'account_owner'], 'people');
  const labelColumn = pillColumn(cols, kind === 'contacts' ? ['lifecycle', 'type', 'segment'] : ['industry', 'health']);
  const emailColumn = kind === 'contacts' ? findColumn(cols, ['email'], 'email') : undefined;
  const titleColumn = kind === 'contacts' ? findColumn(cols, ['job_title', 'title'], 'text') : undefined;
  const lastContactedColumn = kind === 'contacts' ? findColumn(cols, ['last_contacted'], 'date') : undefined;
  const websiteColumn = kind === 'accounts' ? findColumn(cols, ['website', 'domain'], 'link') : undefined;
  const accountColumn = kind === 'contacts' ? findColumn(cols, ['account', 'company'], 'connect_boards') : undefined;
  const accountNames = new Map<string, string>();
  if (accountColumn) {
    const linked = await loadItemsByIds(ctx, boardItems.flatMap((item) => readConnect(item.values, accountColumn)));
    for (const row of linked) accountNames.set(row.id, row.name);
  }
  const rows: CrmRecordRowDto[] = boardItems
    .map((item) => ({
      id: item.id,
      name: item.name,
      owner: person(users, readPeople(item.values, ownerColumn)),
      label: pillLabel(item, labelColumn),
      email: readEmail(item.values, emailColumn),
      title: readText(item.values, titleColumn),
      account:
        readConnect(item.values, accountColumn)
          .map((id) => accountNames.get(id))
          .find(Boolean) ?? null,
      domain: readDomain(item.values, websiteColumn),
      lastContacted: readDate(item.values, lastContactedColumn),
      updatedAt: item.updatedAt.toISOString(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return { kind, board: board.ref, rows };
}

/** What the "Log activity" composer can link to, for a contact, account or deal. */
export async function getActivityOptions(ctx: ServiceContext, itemId: string): Promise<ActivityOptionsDto> {
  const { item, board } = await requireItem(ctx, itemId, 'read');
  const kind = board.kind;
  if (!['contacts', 'accounts', 'deals'].includes(kind)) throw new NotFoundError('Contact, account or deal');
  const around = await neighbors(ctx, [item.id]);
  const ref = (entry: { item: ItemRow }): RecordRefDto => ({ id: entry.item.id, name: entry.item.name, boardId: entry.item.boardId });
  const self = { id: item.id, name: item.name, boardId: item.boardId };
  let contacts = around.filter((entry) => entry.board.kind === 'contacts').map(ref);
  let deals = around.filter((entry) => entry.board.kind === 'deals').map(ref);
  if (kind === 'contacts') contacts = [self, ...contacts.filter((entry) => entry.id !== item.id)];
  if (kind === 'deals') deals = [self, ...deals.filter((entry) => entry.id !== item.id)];
  const { activityRef, activityTypes } = await activityContext(ctx);
  return {
    record: { ...self, kind: kind as ActivityOptionsDto['record']['kind'] },
    activityBoard: activityRef,
    types: activityTypes,
    contacts: contacts.slice(0, 50),
    deals: deals.slice(0, 50),
    defaultContactIds: kind === 'deals' || kind === 'accounts' ? contacts.slice(0, 1).map((entry) => entry.id) : [item.id],
    defaultDealIds: kind === 'deals' ? [item.id] : [],
  };
}
