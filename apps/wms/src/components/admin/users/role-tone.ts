/**
 * Badge tone for a role. A role name is an identity, not a state (docs/design/UI-CLEANUP.md
 * "Pills"), so roles stay neutral. Only privileged roles (admin, owner) get the info tone so
 * they can be found at a glance; no role reads as a warning, success or danger.
 */
export type RoleTone = 'info' | 'neutral';

export function roleTone(role: {
  readonly key?: string | null;
  readonly name: string;
  readonly category?: string | null;
}): RoleTone {
  const key = (role.key ?? '').toLowerCase();
  const name = role.name.toLowerCase();
  if (key === 'admin' || key === 'owner' || /\b(admin|owner|administrator)\b/.test(name)) return 'info';
  return 'neutral';
}
