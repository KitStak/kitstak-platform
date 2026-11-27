import { describe, expect, it } from 'vitest';
import { buildTemplateGallery } from '@/server/services/wizards-gallery';
import { BOARD_TEMPLATES } from '@/server/services/templates/crm';
import {
  addItemLabel,
  managingForTerminology,
  rememberPrivacy,
  rememberedPrivacy,
  resolveTemplateId,
  terminologyFor,
  validateBoardSetup,
  type BoardSetupState,
} from './board-setup';
import { entrySummary, filterGallery, isSubsequence, navCounts, scoreEntry } from './gallery';
import { describeParseProblems, expiresIn, grantableRoles, inviteLink, parseInvitees, splitAddresses } from './invites';
import {
  EMPTY_DRAFT,
  buildOnboardingPayload,
  loadDraft,
  recommendStarter,
  saveDraft,
  starterTemplateIds,
  validateStep,
} from './onboarding';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  };
}

describe('template gallery', () => {
  const gallery = buildTemplateGallery();

  it('ships at least 12 non-blank templates with sample rows for previews', () => {
    const boards = gallery.filter((entry) => entry.type === 'board' && entry.id !== 'blank');
    expect(boards.length).toBeGreaterThanOrEqual(12);
    for (const entry of gallery) {
      expect(entry.boards.length).toBeGreaterThan(0);
      for (const board of entry.boards) expect(board.columns.some((column) => column.type === 'name')).toBe(true);
    }
    expect(BOARD_TEMPLATES.filter((template) => template.id !== 'blank').length).toBeGreaterThanOrEqual(12);
  });

  it('every template id is unique and the CRM suite bundles five connected boards', () => {
    const ids = gallery.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    const suite = gallery.find((entry) => entry.type === 'solution');
    expect(suite?.boards.map((board) => board.templateId)).toHaveLength(5);
    expect(suite?.includesDashboard).toBe(true);
  });

  it('searches names, tags and column titles, best match first', () => {
    expect(filterGallery(gallery, 'all', 'recruit')[0]?.id).toBe('hr-recruiting');
    const byColumn = filterGallery(gallery, 'all', 'close probability').map((entry) => entry.id);
    expect(byColumn).toContain('crm-deals');
    expect(filterGallery(gallery, 'all', 'zzzz-nothing')).toEqual([]);
    expect(scoreEntry('', gallery[0]!)).toBe(1);
  });

  it('filters by rail category and counts', () => {
    const hr = filterGallery(gallery, 'hr', '');
    expect(hr.every((entry) => entry.category === 'hr')).toBe(true);
    const counts = navCounts(gallery);
    expect(counts.all).toBe(gallery.length);
    expect(counts.recommended).toBeGreaterThan(3);
  });

  it('summarizes cards and matches subsequences', () => {
    expect(entrySummary(gallery[0]!)).toMatch(/5 boards/);
    expect(isSubsequence('prpsl', 'proposals')).toBe(true);
    expect(isSubsequence('xyz', 'proposals')).toBe(false);
  });
});

describe('board setup', () => {
  const base: BoardSetupState = {
    name: 'Q3 pipeline',
    managing: 'deals',
    customTerm: '',
    privacy: 'main',
    workspaceId: 'w1',
    folderId: null,
    withSampleData: false,
  };

  it('validates name, custom terminology and workspace', () => {
    expect(validateBoardSetup(base)).toEqual({});
    expect(validateBoardSetup({ ...base, name: '  ' }).name).toBeTruthy();
    expect(validateBoardSetup({ ...base, name: 'x'.repeat(121) }).name).toMatch(/120/);
    expect(validateBoardSetup({ ...base, managing: 'custom' }).customTerm).toBeTruthy();
    expect(validateBoardSetup({ ...base, workspaceId: null }).workspaceId).toBeTruthy();
  });

  it('seeds CRM templates for a blank start and keeps a chosen template', () => {
    expect(resolveTemplateId(null, 'deals')).toBe('crm-deals');
    expect(resolveTemplateId('blank', 'items')).toBe('blank');
    expect(resolveTemplateId('hr-recruiting', 'deals')).toBe('hr-recruiting');
  });

  it('derives terminology and labels', () => {
    expect(terminologyFor({ managing: 'leads', customTerm: '' })).toBe('Lead');
    expect(terminologyFor({ managing: 'custom', customTerm: ' Shipment ' })).toBe('Shipment');
    expect(managingForTerminology('deal')).toBe('deals');
    expect(managingForTerminology('Candidate')).toBe('custom');
    expect(addItemLabel('Deal')).toBe('New deal');
  });

  it('remembers privacy per workspace', () => {
    const storage = memoryStorage();
    expect(rememberedPrivacy('w1', storage)).toBe('main');
    rememberPrivacy('w1', 'private', storage);
    expect(rememberedPrivacy('w1', storage)).toBe('private');
    expect(rememberedPrivacy('w2', storage)).toBe('main');
    storage.setItem('kitstak.wizards.privacy.v1', '{bad json');
    expect(rememberedPrivacy('w1', storage)).toBe('main');
  });
});

describe('invites', () => {
  it('parses pasted lists with names, dedupes and flags invalid addresses', () => {
    expect(splitAddresses('Ana Ruiz <Ana@Acme.com>, bo@y.io; mailto:c@z.dev')).toEqual([
      'ana@acme.com',
      'bo@y.io',
      'c@z.dev',
    ]);
    const parsed = parseInvitees('ana@acme.com nope ana@acme.com', [], 'member');
    expect(parsed.added).toEqual([{ email: 'ana@acme.com', role: 'member' }]);
    expect(parsed.invalid).toEqual(['nope']);
    expect(parsed.duplicates).toEqual(['ana@acme.com']);
    expect(describeParseProblems(parsed)).toMatch(/isn’t a valid/);
    const blocked = parseInvitees('x@y.com', [], 'viewer', new Set(['x@y.com']));
    expect(blocked.added).toHaveLength(0);
  });

  it('caps the list and limits grantable roles', () => {
    const many = Array.from({ length: 52 }, (_, index) => `p${index}@x.com`).join(' ');
    const parsed = parseInvitees(many, [], 'member');
    expect(parsed.added).toHaveLength(50);
    expect(parsed.overflow).toBe(2);
    expect(grantableRoles('member').map((role) => role.value)).not.toContain('admin');
    expect(grantableRoles('owner').map((role) => role.value)).toContain('admin');
  });

  it('builds links and expiry labels', () => {
    expect(inviteLink('http://localhost:3100/', 'abc')).toBe('http://localhost:3100/welcome/invite/abc');
    // With a Portal address the link is the Portal's invite page: the one place a person joins.
    expect(inviteLink('http://localhost:3100/', 'abc', 'http://localhost:3300/')).toBe('http://localhost:3300/invite/abc');
    expect(inviteLink('http://localhost:3100/', 'abc', '  ')).toBe('http://localhost:3100/welcome/invite/abc');
    expect(inviteLink('http://localhost:3100/', 'abc', null)).toBe('http://localhost:3100/welcome/invite/abc');
    const now = Date.parse('2026-11-05T00:00:00Z');
    expect(expiresIn('2026-11-12T00:00:00Z', now)).toBe('Expires in 7 days');
    expect(expiresIn('2026-11-04T00:00:00Z', now)).toBe('Expired');
  });
});

describe('onboarding', () => {
  it('requires an organization name on the first step only', () => {
    expect(validateStep('about', EMPTY_DRAFT).organizationName).toBeTruthy();
    expect(validateStep('about', { ...EMPTY_DRAFT, organizationName: 'Acme' })).toEqual({});
    expect(validateStep('team', EMPTY_DRAFT)).toEqual({});
  });

  it('recommends a role-aware starter', () => {
    expect(recommendStarter({ role: 'cs', manages: [] })).toBe('success');
    expect(recommendStarter({ role: 'sdr', manages: [] })).toBe('prospecting');
    expect(recommendStarter({ role: 'ae', manages: ['deals'] })).toBe('pipeline');
    expect(recommendStarter({ role: 'manager', manages: [] })).toBe('full');
  });

  it('builds the payload with extras and a fallback org name', () => {
    expect(starterTemplateIds('pipeline', ['quotes'])).toEqual([
      'crm-deals',
      'crm-accounts',
      'crm-contacts',
      'sales-quotes',
    ]);
    const payload = buildOnboardingPayload({ ...EMPTY_DRAFT, role: 'cs' }, 'Jordan');
    expect(payload.organizationName).toBe('Jordan’s team');
    expect(payload.workspaceName).toBe('Customer Success');
    expect(payload.role).toBe('cs');
  });

  it('round-trips drafts and never resumes on the done step', () => {
    const storage = memoryStorage();
    saveDraft(storage, { step: 5, draft: { ...EMPTY_DRAFT, organizationName: 'Acme' } });
    expect(loadDraft(storage)).toEqual({ step: 4, draft: { ...EMPTY_DRAFT, organizationName: 'Acme' } });
    storage.setItem('kitstak.welcome.draft.v1', '{"step":99}');
    expect(loadDraft(storage)).toBeNull();
  });
});
