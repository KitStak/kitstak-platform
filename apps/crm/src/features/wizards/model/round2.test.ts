import { describe, expect, it } from 'vitest';
import { buildTemplateGallery } from '@/server/services/wizards-gallery';
import type { GalleryBoard } from '@/server/services/wizards-gallery';
import { inviteAcceptState, maskEmail } from './invite-accept';
import { describeParseProblems, parseInvitees, roleHint, roleLabel, splitEntries } from './invites';
import { canOpenWizard, deniedMessage } from './permissions';
import { buildPreviewGroups, labelForGroup, previewColumnWidth, thumbnailLayout } from './preview-data';

const NOW = Date.UTC(2026, 0, 12);
const gallery = buildTemplateGallery();
const board = (id: string): GalleryBoard => {
  const entry = gallery.find((item) => item.id === id);
  if (!entry?.boards[0]) throw new Error(`missing ${id}`);
  return entry.boards[0];
};

describe('splitEntries / parseInvitees with names', () => {
  it('keeps "Name <email>" display names, in order', () => {
    expect(splitEntries('Ana Ruiz <ANA@x.com>, bo@y.io; "Cy Lee" <cy@z.dev>')).toEqual([
      { email: 'ana@x.com', name: 'Ana Ruiz' },
      { email: 'bo@y.io' },
      { email: 'cy@z.dev', name: 'Cy Lee' },
    ]);
  });

  it('does not lose an address typed before a named entry', () => {
    expect(splitEntries('bo@y.io Ana Ruiz <ana@x.com>')).toEqual([{ email: 'bo@y.io' }, { email: 'ana@x.com', name: 'Ana Ruiz' }]);
  });

  it('flags people who are already members before sending', () => {
    const parsed = parseInvitees('ana@x.com, bo@y.io', [], 'member', new Set(), new Set(['ana@x.com']));
    expect(parsed.added.map((row) => row.email)).toEqual(['bo@y.io']);
    expect(parsed.members).toEqual(['ana@x.com']);
    expect(describeParseProblems(parsed)).toBe('ana@x.com is already a member.');
  });

  it('carries the name onto the invitee', () => {
    const parsed = parseInvitees('Ana Ruiz <ana@x.com>', [], 'viewer');
    expect(parsed.added).toEqual([{ email: 'ana@x.com', role: 'viewer', name: 'Ana Ruiz' }]);
  });
});

describe('role labels', () => {
  it('labels every org role, owner included', () => {
    expect(roleLabel('owner')).toBe('Owner');
    expect(roleLabel('member')).toBe('Member');
    expect(roleLabel(null)).toBe('Member');
    expect(roleHint('member')).toBe('Member: create and edit boards');
  });
});

describe('inviteAcceptState', () => {
  const base = {
    status: 'pending',
    expiresAt: new Date(NOW + 86_400_000),
    invitedEmail: 'Ana@x.com',
    sessionEmail: 'ana@x.com',
    isMember: false,
    now: NOW,
  };
  it('is ready for the invited address', () => expect(inviteAcceptState(base)).toBe('ready'));
  it('detects every refusal', () => {
    expect(inviteAcceptState(null)).toBe('invalid');
    expect(inviteAcceptState({ ...base, isMember: true })).toBe('member');
    // A teammate (already a member) opening someone else's link sees whom it is for.
    expect(inviteAcceptState({ ...base, isMember: true, sessionEmail: 'owner@x.com' })).toBe('mismatch');
    expect(inviteAcceptState({ ...base, status: 'accepted' })).toBe('accepted');
    expect(inviteAcceptState({ ...base, status: 'canceled' })).toBe('revoked');
    expect(inviteAcceptState({ ...base, expiresAt: new Date(NOW - 1) })).toBe('expired');
    expect(inviteAcceptState({ ...base, sessionEmail: 'bo@x.com' })).toBe('mismatch');
  });
  it('masks the invited address', () => expect(maskEmail('ana@northwind.example')).toBe('a•••@northwind.example'));
});

describe('wizard permissions', () => {
  it('maps each wizard to the API permission', () => {
    expect(canOpenWizard('board', ['board:create'])).toBe(true);
    expect(canOpenWizard('board', ['board:read'])).toBe(false);
    expect(canOpenWizard('folder', ['workspace:write'])).toBe(true);
    expect(canOpenWizard('solution', ['workspace:write'])).toBe(false);
    expect(canOpenWizard('solution', ['workspace:write', 'board:create'])).toBe(true);
    expect(deniedMessage('board')).toBe('Ask an admin to create boards');
  });
});

describe('buildPreviewGroups', () => {
  const deals = buildPreviewGroups(board('crm-deals'), { now: NOW });

  it('fills every group, with fewer rows in the closed groups', () => {
    expect(deals.map((group) => group.rows.length)).toEqual([3, 3, 2, 2]);
  });

  it('puts closed-won rows on the Won stage at 100% and lost at 0%', () => {
    const won = deals.find((group) => group.group.key === 'closed_won');
    const lost = deals.find((group) => group.group.key === 'closed_lost');
    expect(won?.rows.every((row) => (row.values.stage as { labelId: string }).labelId === 'won')).toBe(true);
    expect(won?.rows.every((row) => row.values.probability === 100)).toBe(true);
    expect(lost?.rows.every((row) => row.values.probability === 0)).toBe(true);
    const open = deals[0]?.rows.map((row) => (row.values.stage as { labelId: string }).labelId) ?? [];
    expect(open).not.toContain('won');
  });

  it('keeps the real sample rows first and fills empty cells', () => {
    const first = deals[0]?.rows[0];
    expect(first?.name).toBe('Fleet automation rollout');
    expect(first?.values.probability).toBe(50);
    expect(first?.values.owner).toEqual({ previewPeople: expect.any(Array) });
    expect(first?.values.deal_value).toEqual({ amount: expect.any(Number), currency: 'USD' });
    expect(first?.values.forecast).toEqual({ amount: expect.any(Number), currency: 'USD' });
  });

  it('gives contacts realistic emails and phones', () => {
    const contacts = buildPreviewGroups(board('crm-leads'), { now: NOW });
    const row = contacts[0]?.rows[0];
    const emailColumn = board('crm-leads').columns.find((column) => column.type === 'email');
    if (emailColumn) expect((row?.values[emailColumn.key] as { email: string }).email).toMatch(/@.+\.example$/);
  });

  it('is deterministic for a fixed clock', () => {
    expect(buildPreviewGroups(board('proj-tracker'), { now: NOW })).toEqual(buildPreviewGroups(board('proj-tracker'), { now: NOW }));
  });

  it('matches group titles to labels only on whole words', () => {
    expect(labelForGroup({ key: 'this_quarter', title: 'This quarter', color: 'blue' }, [{ id: 'won', name: 'Won', color: 'green' }])).toBeNull();
  });
});

describe('thumbnail layouts and widths', () => {
  it('varies composition by template', () => {
    expect(thumbnailLayout(board('crm-deals'))).toBe('kanban');
    expect(thumbnailLayout(board('proj-tracker'))).toBe('timeline');
    expect(thumbnailLayout(board('ops-requests'))).toBe('form');
    expect(thumbnailLayout(board('blank'))).toBe('blank');
    const layouts = new Set(gallery.flatMap((entry) => entry.boards.map((item) => thumbnailLayout(item))));
    expect(layouts.size).toBeGreaterThanOrEqual(4);
  });

  it('uses fixed widths per column type', () => {
    expect(previewColumnWidth({ type: 'name' })).toBe(240);
    expect(previewColumnWidth({ type: 'email' })).toBeGreaterThan(previewColumnWidth({ type: 'people' }));
  });
});
