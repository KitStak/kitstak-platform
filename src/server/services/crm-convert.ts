/**
 * Lead conversion: Lead → (match or create) Account + Contact → optional Deal, all linked via
 * connect_boards (reciprocal columns stay in sync), the lead marked qualified and moved, and a
 * `crm.lead_converted` activity row recorded as the durable "converted" marker.
 */
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { activityLog, groups, items } from '@/server/db/schema';
import { BadRequestError, ConflictError, NotFoundError } from '@/server/http/errors';
import { requireBoard, requireItem } from './access';
import { logActivity } from './activity';
import { inTransaction, type ServiceContext } from './context';
import {
  connectColumnTo,
  currencyOf,
  findColumn,
  labelDto,
  labelsOf,
  loadBoardRows,
  loadCrmBoard,
  loadItemsByIds,
  orgUsers,
  readConnect,
  readDomain,
  readEmail,
  readLabelId,
  readPeople,
  readPhone,
  readText,
  resolveCrmBoards,
  statusColumnFor,
  toRef,
  type CrmBoard,
} from './crm-boards';
import type {
  ConversionPreviewDto,
  ConversionResultDto,
  ConvertedRecordDto,
  ConvertLeadInput,
  CrmUserDto,
  MatchCandidateDto,
} from './crm-contracts';
import { domainFromUrl, emailDomain, matchAccounts, matchContacts } from './crm-model';
import { dealColumns, dealStages } from './crm-pipeline';
import type { ColumnRow } from './item-reads';
import { finishItemMutation, insertItem, moveItem, updateItem } from './items';
import { createSystemUpdate } from './updates';

export const LEAD_CONVERTED_ACTION = 'crm.lead_converted';

function leadColumns(columns: readonly ColumnRow[]) {
  return {
    email: findColumn(columns, ['email'], 'email'),
    phone: findColumn(columns, ['phone'], 'phone'),
    company: findColumn(columns, ['company', 'company_name', 'account'], 'text'),
    title: findColumn(columns, ['job_title', 'title'], 'text'),
    owner: findColumn(columns, ['owner', 'lead_owner'], 'people'),
    source: findColumn(columns, ['source', 'lead_source'], 'status'),
  };
}

async function loadLead(ctx: ServiceContext, itemId: string) {
  const { item, board } = await requireItem(ctx, itemId, 'read');
  if (board.kind !== 'leads' || item.parentItemId) throw new NotFoundError('Lead');
  const loaded = await loadCrmBoard(ctx, toRef(board, 0));
  if (!loaded) throw new NotFoundError('Lead');
  return { item, board: loaded };
}

async function conversionMarker(ctx: ServiceContext, itemId: string) {
  const [row] = await ctx.db
    .select({ after: activityLog.after, at: activityLog.createdAt })
    .from(activityLog)
    .where(and(eq(activityLog.orgId, ctx.orgId), eq(activityLog.itemId, itemId), eq(activityLog.action, LEAD_CONVERTED_ACTION)))
    .orderBy(desc(activityLog.createdAt))
    .limit(1);
  if (!row) return null;
  const after = (row.after ?? {}) as { accountId?: string; contactId?: string; dealId?: string };
  return {
    at: row.at.toISOString(),
    accountId: after.accountId ?? null,
    contactId: after.contactId ?? null,
    dealId: after.dealId ?? null,
  };
}

async function canWrite(ctx: ServiceContext, boardId: string | undefined): Promise<boolean> {
  if (!boardId) return false;
  return requireBoard(ctx, boardId, 'write').then(
    () => true,
    () => false,
  );
}

function ref(board: CrmBoard | null) {
  return board?.ref ?? null;
}

export async function getConversionPreview(ctx: ServiceContext, itemId: string): Promise<ConversionPreviewDto> {
  const lead = await loadLead(ctx, itemId);
  const resolved = await resolveCrmBoards(ctx);
  const [accounts, contacts, deals, users, converted] = await Promise.all([
    loadCrmBoard(ctx, resolved.primary.accounts),
    loadCrmBoard(ctx, resolved.primary.contacts),
    loadCrmBoard(ctx, resolved.primary.deals),
    orgUsers(ctx),
    conversionMarker(ctx, itemId),
  ]);
  const cols = leadColumns(lead.board.columns);
  const values = lead.item.values;
  const email = readEmail(values, cols.email);
  const company = readText(values, cols.company);

  let accountMatches: MatchCandidateDto[] = [];
  let accountNames = new Map<string, string>();
  if (accounts) {
    const websiteColumn = findColumn(accounts.columns, ['website', 'domain'], 'link');
    const rows = await loadBoardRows(ctx, accounts.row.id);
    accountNames = new Map(rows.map((row) => [row.id, row.name]));
    accountMatches = matchAccounts(
      { email, company },
      rows.map((row) => ({ id: row.id, name: row.name, domain: readDomain(row.values, websiteColumn) })),
    ).map((match) => ({
      id: match.record.id,
      name: match.record.name,
      boardId: accounts.row.id,
      reason: match.reason,
      confidence: match.confidence,
      detail: match.record.domain,
    }));
  }
  let contactMatches: MatchCandidateDto[] = [];
  if (contacts) {
    const emailColumn = findColumn(contacts.columns, ['email'], 'email');
    const accountColumn = connectColumnTo(contacts.columns, accounts?.row.id, ['account']);
    const rows = await loadBoardRows(ctx, contacts.row.id);
    contactMatches = matchContacts(
      { name: lead.item.name, email },
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        email: readEmail(row.values, emailColumn),
        accountName: accountNames.get(readConnect(row.values, accountColumn)[0] ?? '') ?? null,
      })),
    ).map((match) => ({
      id: match.record.id,
      name: match.record.name,
      boardId: contacts.row.id,
      reason: match.reason,
      confidence: match.confidence,
      detail: [match.record.email, match.record.accountName].filter(Boolean).join(' · ') || null,
    }));
  }

  let stages: ConversionPreviewDto['stages'] = [];
  let currency = 'USD';
  if (deals) {
    const dc = dealColumns(deals);
    currency = currencyOf(dc.value);
    stages = dealStages(deals, dc, await loadBoardRows(ctx, deals.row.id)).stages.map((stage) => ({
      ...stage.label,
      probability: stage.probability,
      kind: stage.kind,
    }));
  }
  const ownerId = readPeople(values, cols.owner)[0];
  const [leadWritable, accountsWritable, contactsWritable] = await Promise.all([
    canWrite(ctx, lead.board.row.id),
    canWrite(ctx, accounts?.row.id),
    canWrite(ctx, contacts?.row.id),
  ]);
  return {
    lead: {
      id: lead.item.id,
      name: lead.item.name,
      boardId: lead.board.row.id,
      email,
      phone: readPhone(values, cols.phone),
      company,
      title: readText(values, cols.title),
      domain: emailDomain(email),
      owner: ownerId ? (users.get(ownerId) ?? null) : null,
      source: labelDto(cols.source, readLabelId(values, cols.source)),
    },
    converted,
    boards: { accounts: ref(accounts), contacts: ref(contacts), deals: ref(deals) },
    accountMatches,
    contactMatches,
    stages,
    defaultStageId: stages.find((stage) => stage.kind === 'open')?.id ?? null,
    currency,
    users: [...users.values()] satisfies CrmUserDto[],
    canEdit: leadWritable && accountsWritable && contactsWritable,
  };
}

async function qualifiedGroup(ctx: ServiceContext, boardId: string): Promise<string | null> {
  const rows = await ctx.db
    .select({ id: groups.id, title: groups.title })
    .from(groups)
    .where(and(eq(groups.boardId, boardId), eq(groups.orgId, ctx.orgId), isNull(groups.deletedAt), isNull(groups.archivedAt)))
    .orderBy(asc(groups.position));
  return rows.find((row) => /convert|qualif/i.test(row.title) && !/dis|un/i.test(row.title))?.id ?? null;
}

function paragraph(text: string) {
  return { type: 'doc' as const, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}

/** Matching label id on another status column (by id, then by name). */
function sameLabel(from: ColumnRow | undefined, to: ColumnRow | undefined, labelId: string | null): string | null {
  if (!labelId || !from || !to) return null;
  const target = labelsOf(to).filter((label) => !label.isDefault);
  if (target.some((label) => label.id === labelId)) return labelId;
  const name = labelsOf(from).find((label) => label.id === labelId)?.name.toLowerCase();
  return target.find((label) => label.name.toLowerCase() === name)?.id ?? null;
}

export async function convertLead(
  ctx: ServiceContext,
  itemId: string,
  input: ConvertLeadInput,
): Promise<ConversionResultDto> {
  const lead = await loadLead(ctx, itemId);
  await requireBoard(ctx, lead.board.row.id, 'write');
  if (await conversionMarker(ctx, itemId)) throw new ConflictError('This lead was already converted');
  const resolved = await resolveCrmBoards(ctx);
  const [accounts, contacts, deals] = await Promise.all([
    loadCrmBoard(ctx, resolved.primary.accounts),
    loadCrmBoard(ctx, resolved.primary.contacts),
    loadCrmBoard(ctx, resolved.primary.deals),
  ]);
  if (!accounts) throw new BadRequestError('Create an Accounts board before converting leads');
  if (!contacts) throw new BadRequestError('Create a Contacts board before converting leads');
  if (input.deal && !deals) throw new BadRequestError('Create a Deals board to add a deal');
  await requireBoard(ctx, accounts.row.id, 'write');
  await requireBoard(ctx, contacts.row.id, 'write');
  if (input.deal && deals) await requireBoard(ctx, deals.row.id, 'write');

  const lc = leadColumns(lead.board.columns);
  const leadValues = lead.item.values;
  const ownerId = input.ownerId ?? readPeople(leadValues, lc.owner)[0] ?? ctx.userId ?? undefined;
  const ownerValue = ownerId ? { ids: [ownerId] } : undefined;

  return inTransaction(ctx, async (tx) => {
    // Serialise concurrent conversions of the same lead: lock the lead row, then re-check the
    // durable marker under the lock, so a double-click or parallel POST gets a 409 instead of
    // creating a second account/contact/deal.
    const [locked] = await tx.db
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.id, lead.item.id), eq(items.orgId, tx.orgId), isNull(items.deletedAt)))
      .for('update');
    if (!locked) throw new NotFoundError('Lead');
    if (await conversionMarker(tx, itemId)) throw new ConflictError('This lead was already converted');

    // Account -----------------------------------------------------------------------------
    let account: ConvertedRecordDto;
    if (input.account.mode === 'existing') {
      const [row] = await loadItemsByIds(tx, [input.account.itemId], [accounts.row.id]);
      if (!row) throw new BadRequestError('The selected account no longer exists');
      account = { id: row.id, name: row.name, boardId: row.boardId, created: false };
    } else {
      const websiteColumn = findColumn(accounts.columns, ['website', 'domain'], 'link');
      const ownerColumn = findColumn(accounts.columns, ['owner', 'account_owner'], 'people');
      const domain = domainFromUrl(input.account.website) ?? null;
      const { row, events } = await insertItem(tx, accounts.row, accounts.columns, {
        name: input.account.name,
        values: {
          ...(websiteColumn && domain && { [websiteColumn.key]: { url: `https://${domain}`, text: domain } }),
          ...(ownerColumn && ownerValue && { [ownerColumn.key]: ownerValue }),
        } as never,
        position: 'top',
      });
      await finishItemMutation(tx, accounts.row, [row.id], events);
      account = { id: row.id, name: row.name, boardId: row.boardId, created: true };
    }

    // Contact -----------------------------------------------------------------------------
    const cc = {
      email: findColumn(contacts.columns, ['email'], 'email'),
      phone: findColumn(contacts.columns, ['phone'], 'phone'),
      title: findColumn(contacts.columns, ['job_title', 'title'], 'text'),
      owner: findColumn(contacts.columns, ['owner'], 'people'),
      account: connectColumnTo(contacts.columns, accounts.row.id, ['account']),
    };
    let contact: ConvertedRecordDto;
    if (input.contact.mode === 'existing') {
      const [row] = await loadItemsByIds(tx, [input.contact.itemId], [contacts.row.id]);
      if (!row) throw new BadRequestError('The selected contact no longer exists');
      const patch: Record<string, unknown> = {};
      const fill = (column: ColumnRow | undefined, value: unknown) => {
        if (column && value !== undefined && value !== null && row.values[column.key] === undefined) patch[column.key] = value;
      };
      if (input.contact.fillEmpty) {
        fill(cc.email, leadValues[lc.email?.key ?? ''] ?? undefined);
        fill(cc.phone, leadValues[lc.phone?.key ?? ''] ?? undefined);
        fill(cc.title, readText(leadValues, lc.title));
        fill(cc.owner, ownerValue);
      }
      if (cc.account && !readConnect(row.values, cc.account).includes(account.id)) {
        const allowMultiple = (cc.account.settings as { allowMultiple?: boolean }).allowMultiple !== false;
        patch[cc.account.key] = { itemIds: allowMultiple ? [...readConnect(row.values, cc.account), account.id] : [account.id] };
      }
      if (Object.keys(patch).length > 0) await updateItem(tx, row.id, { values: patch as never });
      contact = { id: row.id, name: row.name, boardId: row.boardId, created: false };
    } else {
      const { row, events } = await insertItem(tx, contacts.row, contacts.columns, {
        name: input.contact.name,
        values: {
          ...(cc.email && input.contact.email && { [cc.email.key]: { email: input.contact.email } }),
          ...(cc.phone && input.contact.phone && { [cc.phone.key]: { phone: input.contact.phone } }),
          ...(cc.title && input.contact.title && { [cc.title.key]: input.contact.title }),
          ...(cc.owner && ownerValue && { [cc.owner.key]: ownerValue }),
          ...(cc.account && { [cc.account.key]: { itemIds: [account.id] } }),
        } as never,
        position: 'top',
      });
      await finishItemMutation(tx, contacts.row, [row.id], events);
      contact = { id: row.id, name: row.name, boardId: row.boardId, created: true };
    }

    // Deal --------------------------------------------------------------------------------
    let deal: ConvertedRecordDto | null = null;
    if (input.deal && deals) {
      const dc = dealColumns(deals, { accountsBoardId: accounts.row.id, contactsBoardId: contacts.row.id });
      const stages = dealStages(deals, dc, []).stages;
      const stageId =
        input.deal.stageLabelId && stages.some((stage) => stage.label.id === input.deal?.stageLabelId)
          ? input.deal.stageLabelId
          : (stages.find((stage) => stage.kind === 'open')?.label.id ?? null);
      const probability = stages.find((stage) => stage.label.id === stageId)?.probability;
      const sourceId = sameLabel(lc.source, dc.source, readLabelId(leadValues, lc.source));
      const { row, events } = await insertItem(tx, deals.row, deals.columns, {
        name: input.deal.name,
        values: {
          ...(dc.stage && stageId && { [dc.stage.key]: { labelId: stageId } }),
          ...(dc.value &&
            input.deal.amount !== undefined && {
              [dc.value.key]:
                dc.value.type === 'currency' ? { amount: input.deal.amount, currency: currencyOf(dc.value) } : input.deal.amount,
            }),
          ...(dc.probability && probability !== undefined && { [dc.probability.key]: probability }),
          ...(dc.closeDate && input.deal.closeDate && { [dc.closeDate.key]: { date: input.deal.closeDate } }),
          ...(dc.owner && ownerValue && { [dc.owner.key]: ownerValue }),
          ...(dc.account && { [dc.account.key]: { itemIds: [account.id] } }),
          ...(dc.contacts && { [dc.contacts.key]: { itemIds: [contact.id] } }),
          ...(dc.source && sourceId && { [dc.source.key]: { labelId: sourceId } }),
        } as never,
        position: 'top',
      });
      await finishItemMutation(tx, deals.row, [row.id], events);
      deal = { id: row.id, name: row.name, boardId: row.boardId, created: true };
    }

    // Lead: mark qualified, move to the qualified group, record the conversion ---------------
    const statusColumn = statusColumnFor(lead.board.row, lead.board.columns, ['status', 'lead_status']);
    const doneLabel = labelsOf(statusColumn).find((label) => label.isDone);
    if (statusColumn && doneLabel) {
      await updateItem(tx, lead.item.id, { values: { [statusColumn.key]: { labelId: doneLabel.id } } as never });
    }
    const groupId = await qualifiedGroup(tx, lead.board.row.id);
    if (groupId && groupId !== lead.item.groupId) {
      await moveItem(tx, lead.item.id, { groupId, position: 'top' } as never);
    }
    await logActivity(tx, {
      boardId: lead.board.row.id,
      itemId: lead.item.id,
      action: LEAD_CONVERTED_ACTION,
      after: { accountId: account.id, contactId: contact.id, dealId: deal?.id ?? null },
    });
    const summary = [`Converted to contact “${contact.name}”`, `account “${account.name}”`, deal ? `deal “${deal.name}”` : null]
      .filter(Boolean)
      .join(', ');
    await createSystemUpdate(tx, lead.item.id, paragraph(`${summary}.`) as never);
    await createSystemUpdate(tx, contact.id, paragraph(`Converted from lead “${lead.item.name}”.`) as never);
    return {
      lead: { id: lead.item.id, name: lead.item.name, boardId: lead.board.row.id },
      account,
      contact,
      deal,
    };
  });
}
