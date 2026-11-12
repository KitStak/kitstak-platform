import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, ForbiddenError } from '@/server/http/errors';
import type { ServiceContext } from './context';

const createInvitation = vi.fn();
vi.mock('./members', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./members')>();
  return { ...actual, createInvitation: (...args: unknown[]) => createInvitation(...args) };
});

const provisionCrmWorkspace = vi.fn();
vi.mock('./onboarding', () => ({ provisionCrmWorkspace: (...args: unknown[]) => provisionCrmWorkspace(...args) }));

const publish = vi.fn();
vi.mock('@/server/realtime/publisher', () => ({ publish: (...args: unknown[]) => publish(...args) }));

const transaction = vi.fn();
const ctx = {
  db: { transaction: (fn: (tx: unknown) => Promise<unknown>) => transaction(fn) },
  orgId: '00000000-0000-4000-8000-000000000001',
  userId: '00000000-0000-4000-8000-000000000002',
  roles: ['admin'],
} as unknown as ServiceContext;

const { createInvitations, bulkInvitationSchema } = await import('./wizards-invitations');
const { installSolution, installSolutionSchema } = await import('./wizards-solutions');
const { buildTemplateGallery, CRM_SUITE_ID, GALLERY_CATEGORIES } = await import('./wizards-gallery');

beforeEach(() => {
  createInvitation.mockReset();
  provisionCrmWorkspace.mockReset();
  publish.mockReset();
  transaction.mockReset();
  transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn({}));
});

describe('createInvitations', () => {
  it('dedupes repeated emails and returns one result per address', async () => {
    createInvitation.mockImplementation(async (_ctx, entry: { email: string }) => ({ id: `inv-${entry.email}`, email: entry.email }));
    const input = bulkInvitationSchema.parse({
      invitations: [{ email: 'Ana@Example.com' }, { email: 'ana@example.com' }, { email: 'bo@example.com', role: 'viewer' }],
    });
    const results = await createInvitations(ctx, input);
    expect(results.map((row) => row.email)).toEqual(['ana@example.com', 'bo@example.com']);
    expect(results.every((row) => row.ok)).toBe(true);
    expect(createInvitation).toHaveBeenCalledTimes(2);
  });

  it('keeps going after a failed row and maps AppError to code + message', async () => {
    createInvitation
      .mockRejectedValueOnce(new ConflictError('ana@example.com is already a member'))
      .mockResolvedValueOnce({ id: 'inv-2', email: 'bo@example.com' })
      .mockRejectedValueOnce(new ForbiddenError('You can’t invite admins'));
    const results = await createInvitations(
      ctx,
      bulkInvitationSchema.parse({
        invitations: [{ email: 'ana@example.com' }, { email: 'bo@example.com' }, { email: 'cy@example.com', role: 'admin' }],
      }),
    );
    expect(results).toEqual([
      { email: 'ana@example.com', ok: false, code: 'CONFLICT', message: 'ana@example.com is already a member' },
      { email: 'bo@example.com', ok: true, invitation: { id: 'inv-2', email: 'bo@example.com' } },
      { email: 'cy@example.com', ok: false, code: 'FORBIDDEN', message: 'You can’t invite admins' },
    ]);
  });

  it('rethrows unexpected (non-AppError) failures', async () => {
    createInvitation.mockRejectedValueOnce(new Error('db down'));
    await expect(
      createInvitations(ctx, bulkInvitationSchema.parse({ invitations: [{ email: 'ana@example.com' }] })),
    ).rejects.toThrow('db down');
  });

  it('rejects more than 50 invitations and invalid emails at the schema', () => {
    const many = Array.from({ length: 51 }, (_, index) => ({ email: `p${index}@example.com` }));
    expect(bulkInvitationSchema.safeParse({ invitations: many }).success).toBe(false);
    expect(bulkInvitationSchema.safeParse({ invitations: [{ email: 'nope' }] }).success).toBe(false);
  });
});

describe('installSolution', () => {
  it('validates the solution id and workspace name', () => {
    expect(installSolutionSchema.safeParse({ solutionId: 'other', workspaceName: 'Sales' }).success).toBe(false);
    expect(installSolutionSchema.safeParse({ solutionId: CRM_SUITE_ID, workspaceName: '  ' }).success).toBe(false);
    const parsed = installSolutionSchema.parse({ solutionId: CRM_SUITE_ID, workspaceName: ' Sales ' });
    expect(parsed).toEqual({ solutionId: CRM_SUITE_ID, workspaceName: 'Sales', withSampleData: true });
  });

  it('provisions inside one transaction, publishes the workspace change and maps the result', async () => {
    provisionCrmWorkspace.mockResolvedValue({
      workspaceId: 'ws-1',
      dashboardId: 'dash-1',
      boards: [
        { board: { id: 'b-1', name: 'Deals' }, template: { id: 'crm-deals' } },
        { board: { id: 'b-2', name: 'Leads' }, template: { id: 'crm-leads' } },
      ],
    });
    const result = await installSolution(ctx, { solutionId: CRM_SUITE_ID, workspaceName: 'Sales', withSampleData: false });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(provisionCrmWorkspace).toHaveBeenCalledWith(expect.anything(), { workspaceName: 'Sales', withSampleData: false });
    expect(publish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'workspace.changed', ids: ['ws-1'] }));
    expect(result).toEqual({
      workspaceId: 'ws-1',
      dashboardId: 'dash-1',
      boards: [
        { id: 'b-1', name: 'Deals', templateId: 'crm-deals' },
        { id: 'b-2', name: 'Leads', templateId: 'crm-leads' },
      ],
    });
  });

  it('propagates provisioning failures (the transaction rolls back)', async () => {
    provisionCrmWorkspace.mockRejectedValue(new Error('boom'));
    await expect(installSolution(ctx, { solutionId: CRM_SUITE_ID, workspaceName: 'Sales', withSampleData: true })).rejects.toThrow('boom');
    expect(publish).not.toHaveBeenCalled();
  });
});

describe('buildTemplateGallery', () => {
  const gallery = buildTemplateGallery();

  it('ships at least 12 non-blank templates with unique ids', () => {
    expect(gallery.filter((entry) => entry.id !== 'blank').length).toBeGreaterThanOrEqual(12);
    expect(new Set(gallery.map((entry) => entry.id)).size).toBe(gallery.length);
  });

  it('puts the CRM suite first, with five connected boards and a dashboard', () => {
    const [suite] = gallery;
    expect(suite?.id).toBe(CRM_SUITE_ID);
    expect(suite?.type).toBe('solution');
    expect(suite?.boards.map((board) => board.templateId)).toEqual(
      expect.arrayContaining(['crm-leads', 'crm-deals', 'crm-accounts', 'crm-contacts', 'crm-activities']),
    );
    expect(suite?.includesDashboard).toBe(true);
  });

  it('has a template in every category', () => {
    for (const category of GALLERY_CATEGORIES) {
      expect(gallery.some((entry) => entry.category === category), category).toBe(true);
    }
  });

  it('gives every board entry columns, groups, views and no hidden or subitem columns', () => {
    for (const entry of gallery) {
      for (const board of entry.boards) {
        expect(board.columns.some((column) => column.type === 'name'), entry.id).toBe(true);
        expect(board.groups.length, entry.id).toBeGreaterThan(0);
        expect(board.views.length, entry.id).toBeGreaterThan(0);
        expect(board.sampleItems.length).toBeLessThanOrEqual(6);
      }
    }
  });
});
