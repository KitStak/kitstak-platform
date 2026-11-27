/**
 * Who may see program money (docs/programs/SPEC.md A10 and 8.1), and the shared case table that
 * keeps every copy of the rule in lockstep. `apps/projects/src/lib/permissions.ts` (client safe,
 * so it keeps its own copy) and `packages/pm-bridge/src/permissions.ts` both test their rule
 * against `MONEY_READ_CASES`.
 *
 * The rule: org owners and admins always see money. Anyone else needs an EXPLICIT program role
 * (pm.project_members) at or above the program's `money_min_role` (default editor), or to be the
 * program's owner. The implicit role an org member gets on an org visible program never counts.
 * Guests never see money.
 */
export type MoneyOrgRole = 'owner' | 'admin' | 'member' | 'viewer' | 'guest';
export type MoneyProjectRole = 'owner' | 'editor' | 'commenter' | 'viewer';

export interface MoneyReadInput {
  readonly orgRole: MoneyOrgRole | null;
  /** The explicit pm.project_members role, if any. */
  readonly memberRole: MoneyProjectRole | null;
  /** pm.projects.owner_id is the person. */
  readonly isProjectOwner?: boolean;
  /** pm.program_settings.money_min_role. */
  readonly moneyMinRole: MoneyProjectRole;
}

const PROJECT_RANK: Readonly<Record<MoneyProjectRole, number>> = { owner: 4, editor: 3, commenter: 2, viewer: 1 };

export function canReadProgramMoney(input: MoneyReadInput): boolean {
  const { orgRole, memberRole, isProjectOwner, moneyMinRole } = input;
  if (!orgRole || orgRole === 'guest') return false;
  if (orgRole === 'owner' || orgRole === 'admin') return true;
  if (isProjectOwner) return true;
  if (!memberRole) return false;
  return PROJECT_RANK[memberRole] >= PROJECT_RANK[moneyMinRole];
}

export interface MoneyReadCase extends MoneyReadInput {
  readonly name: string;
  readonly expected: boolean;
}

/** Same inputs, same answers, in every app that hides program money. */
export const MONEY_READ_CASES: readonly MoneyReadCase[] = [
  { name: 'org owner without membership', orgRole: 'owner', memberRole: null, moneyMinRole: 'editor', expected: true },
  { name: 'org admin with a viewer membership', orgRole: 'admin', memberRole: 'viewer', moneyMinRole: 'owner', expected: true },
  { name: 'org member with no membership (implicit editor)', orgRole: 'member', memberRole: null, moneyMinRole: 'editor', expected: false },
  { name: 'org member with no membership, minimum viewer', orgRole: 'member', memberRole: null, moneyMinRole: 'viewer', expected: false },
  { name: 'org member explicit editor', orgRole: 'member', memberRole: 'editor', moneyMinRole: 'editor', expected: true },
  { name: 'org member explicit owner', orgRole: 'member', memberRole: 'owner', moneyMinRole: 'editor', expected: true },
  { name: 'org member explicit commenter, minimum editor', orgRole: 'member', memberRole: 'commenter', moneyMinRole: 'editor', expected: false },
  { name: 'org member explicit commenter, minimum commenter', orgRole: 'member', memberRole: 'commenter', moneyMinRole: 'commenter', expected: true },
  { name: 'org member explicit viewer, minimum viewer', orgRole: 'member', memberRole: 'viewer', moneyMinRole: 'viewer', expected: true },
  { name: 'org member explicit editor, minimum owner', orgRole: 'member', memberRole: 'editor', moneyMinRole: 'owner', expected: false },
  { name: 'org member who owns the program', orgRole: 'member', memberRole: null, isProjectOwner: true, moneyMinRole: 'owner', expected: true },
  { name: 'org viewer explicit editor', orgRole: 'viewer', memberRole: 'editor', moneyMinRole: 'editor', expected: true },
  { name: 'org viewer with no membership', orgRole: 'viewer', memberRole: null, moneyMinRole: 'viewer', expected: false },
  { name: 'guest explicit owner', orgRole: 'guest', memberRole: 'owner', moneyMinRole: 'viewer', expected: false },
  { name: 'guest who owns the program', orgRole: 'guest', memberRole: null, isProjectOwner: true, moneyMinRole: 'viewer', expected: false },
  { name: 'not a member of the org', orgRole: null, memberRole: 'owner', moneyMinRole: 'viewer', expected: false },
];
