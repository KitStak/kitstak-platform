/** Pure formatting + filtering helpers for admin, profile and trash (unit tested). */
import type { OrgRole } from '@/server/rbac/permissions';
import type { AdminUserDto, TrashEntryDto } from '@/server/services/admin-contracts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const ROLE_LABEL: Readonly<Record<OrgRole, string>> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
  guest: 'Guest',
};

export const ROLE_DESCRIPTION: Readonly<Record<OrgRole, string>> = {
  owner: 'Full control, including billing and deleting the organization',
  admin: 'Manages people, security and every board',
  member: 'Creates and edits boards, items and automations',
  viewer: 'Reads everything they can see and writes updates',
  guest: 'Works only on boards shared with them',
};

/** "just now", "5 min ago", "3 hr ago", "Yesterday", "4 days ago", then a date. */
export function relativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return 'Never';
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return '—';
  const diff = now.getTime() - time;
  if (diff < 0) {
    const ahead = -diff;
    if (ahead < HOUR) return `in ${Math.max(1, Math.round(ahead / MINUTE))} min`;
    if (ahead < DAY) return `in ${Math.round(ahead / HOUR)} hr`;
    return `in ${Math.round(ahead / DAY)} days`;
  }
  if (diff < MINUTE) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} min ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} hr ago`;
  if (diff < 2 * DAY) return 'Yesterday';
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)} days ago`;
  return formatDate(iso);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined).format(value);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** exponent;
  return `${value >= 10 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`;
}

/** Share 0–100 (clamped) for meters. */
export function percent(used: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((used / limit) * 100)));
}

export function meterTone(pct: number): 'primary' | 'warning' | 'danger' {
  if (pct >= 100) return 'danger';
  if (pct >= 80) return 'warning';
  return 'primary';
}

// ---------------------------------------------------------------------------------------------
// Users table filtering
// ---------------------------------------------------------------------------------------------

export type StatusFilter = 'all' | 'active' | 'deactivated' | 'invited';

export interface UserFilters {
  readonly q: string;
  readonly role: OrgRole | 'all';
  readonly status: StatusFilter;
}

export function filterUsers(users: readonly AdminUserDto[], filters: UserFilters): AdminUserDto[] {
  const q = filters.q.trim().toLowerCase();
  return users.filter((user) => {
    if (filters.role !== 'all' && user.role !== filters.role) return false;
    if (filters.status === 'active' && user.status !== 'active') return false;
    if (filters.status === 'deactivated' && user.status !== 'deactivated') return false;
    if (filters.status === 'invited') return false;
    if (!q) return true;
    return (
      user.name.toLowerCase().includes(q) ||
      user.email.toLowerCase().includes(q) ||
      (user.title ?? '').toLowerCase().includes(q)
    );
  });
}

/** Split comma / space / semicolon separated input into unique, lower-cased emails. */
export function parseEmailList(input: string): { valid: string[]; invalid: string[] } {
  const parts = input
    .split(/[\s,;]+/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const part of [...new Set(parts)]) {
    if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(part)) valid.push(part);
    else invalid.push(part);
  }
  return { valid, invalid };
}

// ---------------------------------------------------------------------------------------------
// Trash
// ---------------------------------------------------------------------------------------------

export interface TrashFilters {
  readonly q: string;
  readonly type: 'all' | TrashEntryDto['type'];
  readonly boardId: string | 'all';
}

export function filterTrash(entries: readonly TrashEntryDto[], filters: TrashFilters): TrashEntryDto[] {
  const q = filters.q.trim().toLowerCase();
  return entries.filter((entry) => {
    if (filters.type !== 'all' && entry.type !== filters.type) return false;
    if (filters.boardId !== 'all' && entry.boardId !== filters.boardId) return false;
    if (!q) return true;
    return (
      entry.name.toLowerCase().includes(q) ||
      entry.boardName.toLowerCase().includes(q) ||
      (entry.groupName ?? '').toLowerCase().includes(q)
    );
  });
}

export function trashBoards(entries: readonly TrashEntryDto[]): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const entry of entries) if (!seen.has(entry.boardId)) seen.set(entry.boardId, entry.boardName);
  return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

export function trashKey(entry: { type: string; id: string }): string {
  return `${entry.type}:${entry.id}`;
}

export function pluralize(count: number, one: string, many = `${one}s`): string {
  return `${formatNumber(count)} ${count === 1 ? one : many}`;
}

// ---------------------------------------------------------------------------------------------
// Password strength (advisory only; the server enforces the length policy)
// ---------------------------------------------------------------------------------------------

export interface PasswordStrength {
  readonly score: 0 | 1 | 2 | 3 | 4;
  readonly label: 'Too short' | 'Weak' | 'Fair' | 'Good' | 'Strong';
}

export function passwordStrength(password: string, minLength = 10): PasswordStrength {
  if (password.length < minLength) return { score: 0, label: 'Too short' };
  let variety = 0;
  if (/[a-z]/.test(password)) variety += 1;
  if (/[A-Z]/.test(password)) variety += 1;
  if (/\d/.test(password)) variety += 1;
  if (/[^A-Za-z0-9]/.test(password)) variety += 1;
  const lengthBonus = password.length >= 16 ? 1 : 0;
  const repeated = /(.)\1{3,}/.test(password) ? 1 : 0;
  const raw = Math.max(1, Math.min(4, variety + lengthBonus - repeated - 1)) as 1 | 2 | 3 | 4;
  const labels = { 1: 'Weak', 2: 'Fair', 3: 'Good', 4: 'Strong' } as const;
  return { score: raw, label: labels[raw] };
}

/** Shortens IPv6 for display (`0000:…:0001` → `::1`); IPv4 and unknown input pass through. */
export function formatIp(ip: string | null | undefined): string {
  if (!ip) return '—';
  if (!ip.includes(':')) return ip;
  const groups = ip.split(':');
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))) return ip;
  const short = groups.map((group) => group.replace(/^0+(?=.)/, '').toLowerCase());
  let bestStart = -1;
  let bestLength = 0;
  for (let index = 0; index < 8; ) {
    if (short[index] !== '0') {
      index += 1;
      continue;
    }
    let end = index;
    while (end < 8 && short[end] === '0') end += 1;
    if (end - index > bestLength) {
      bestStart = index;
      bestLength = end - index;
    }
    index = end;
  }
  if (bestLength < 2) return short.join(':');
  const head = short.slice(0, bestStart).join(':');
  const tail = short.slice(bestStart + bestLength).join(':');
  return `${head}::${tail}`;
}

// ---------------------------------------------------------------------------------------------
// Table sorting (client-side; stable; nulls last in both directions)
// ---------------------------------------------------------------------------------------------

export type SortDirection = 'asc' | 'desc';
export interface SortState<K extends string> {
  readonly key: K;
  readonly direction: SortDirection;
}

export function sortRows<T>(
  rows: readonly T[],
  accessor: (row: T) => string | number | null,
  direction: SortDirection,
): T[] {
  const factor = direction === 'asc' ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, value: accessor(row) }))
    .sort((a, b) => {
      if (a.value === null && b.value === null) return a.index - b.index;
      if (a.value === null) return 1;
      if (b.value === null) return -1;
      const diff =
        typeof a.value === 'number' && typeof b.value === 'number'
          ? a.value - b.value
          : String(a.value).localeCompare(String(b.value), undefined, { sensitivity: 'base', numeric: true });
      return diff === 0 ? a.index - b.index : diff * factor;
    })
    .map((entry) => entry.row);
}

/** Storage for humans: "22 bytes", "1.4 KB", "3.2 GB". */
export function formatStorage(bytes: number): string {
  if (bytes < 1024) return `${formatNumber(bytes)} ${bytes === 1 ? 'byte' : 'bytes'}`;
  return formatBytes(bytes);
}

/** Days until a trash entry is purged, clamped: 0 → "Today", past → "Today". */
export function retentionLabel(daysLeft: number): string {
  if (daysLeft <= 0) return 'Today';
  return `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}`;
}

/** Role changes that need explicit confirmation: escalation to owner/admin, or demoting an owner/admin. */
export function roleChangeNeedsConfirm(from: OrgRole, to: OrgRole): boolean {
  if (from === to) return false;
  return to === 'owner' || to === 'admin' || from === 'owner' || from === 'admin';
}
