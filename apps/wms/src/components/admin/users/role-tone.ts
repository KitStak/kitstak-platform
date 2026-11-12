/** Badge tone for a role pill: privileged roles stand out, limited roles stay quiet. */
export type RoleTone = 'solid' | 'info' | 'success' | 'warning' | 'neutral' | 'primary';

export function roleTone(role: {
  readonly key?: string | null;
  readonly name: string;
  readonly category?: string | null;
}): RoleTone {
  const key = (role.key ?? '').toLowerCase();
  const name = role.name.toLowerCase();
  const category = (role.category ?? '').toLowerCase();
  if (key === 'admin' || key === 'owner' || /\b(admin|owner|administrator)\b/.test(name)) return 'solid';
  if (category === 'client' || /\bclient\b/.test(name)) return 'warning';
  if (key === 'viewer' || /\b(viewer|read[- ]?only)\b/.test(name)) return 'neutral';
  if (key === 'manager' || /\b(manager|supervisor|lead)\b/.test(name)) return 'info';
  if (key === 'operator' || /\b(clerk|operator|picker|packer)\b/.test(name)) return 'success';
  // Custom roles read as neutral metadata, never as a warning or danger tone.
  return 'neutral';
}
