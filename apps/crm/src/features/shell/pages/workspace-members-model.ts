/** Pure rules for the workspace Members tab (unit-tested; mirrors shell-workspace.ts). */
export interface MemberRoleRow {
  readonly userId: string;
  readonly role: 'owner' | 'member';
}

/** Workspace owners and org owners/admins manage members (the server enforces the same rule). */
export function canManageMembers(input: {
  readonly orgRole: string;
  readonly userId: string;
  readonly members: readonly MemberRoleRow[];
}): boolean {
  if (input.orgRole === 'owner' || input.orgRole === 'admin') return true;
  return input.members.some((member) => member.userId === input.userId && member.role === 'owner');
}

/** The last owner can be neither demoted nor removed. */
export function isLastOwner(member: MemberRoleRow, members: readonly MemberRoleRow[]): boolean {
  return member.role === 'owner' && members.filter((entry) => entry.role === 'owner').length <= 1;
}
