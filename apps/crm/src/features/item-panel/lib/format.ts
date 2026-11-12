/**
 * Pure formatting helpers for the item panel (relative time, day buckets, byte sizes, file kinds).
 * Everything takes an explicit `now` so tests and SSR are deterministic.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
export const PANEL_LOCALE = 'en-US';

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** "Just now", "5m", "3h", "Yesterday", "Mon", "Oct 3", "Oct 3, 2024". */
export function formatRelativeShort(iso: string, now: Date): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const diff = now.getTime() - at.getTime();
  if (diff < MINUTE) return 'Just now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m`;
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY);
  if (days === 0) return `${Math.floor(diff / HOUR)}h`;
  if (days === 1) return 'Yesterday';
  if (days < 7) return at.toLocaleDateString(PANEL_LOCALE, { weekday: 'short' });
  if (at.getFullYear() === now.getFullYear()) {
    return at.toLocaleDateString(PANEL_LOCALE, { month: 'short', day: 'numeric' });
  }
  return at.toLocaleDateString(PANEL_LOCALE, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Full timestamp for tooltips: "Tuesday, November 4, 2026 at 3:41 PM". */
export function formatExact(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return at.toLocaleString(PANEL_LOCALE, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Clock time: "3:41 PM". */
export function formatClock(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return at.toLocaleTimeString(PANEL_LOCALE, { hour: 'numeric', minute: '2-digit' });
}

/** Local calendar-day key "YYYY-MM-DD". */
export function dayKey(iso: string): string {
  const at = new Date(iso);
  const month = String(at.getMonth() + 1).padStart(2, '0');
  const day = String(at.getDate()).padStart(2, '0');
  return `${at.getFullYear()}-${month}-${day}`;
}

/** Heading for a day bucket: "Today", "Yesterday", "Monday, Nov 2", "Oct 3, 2024". */
export function dayLabel(key: string, now: Date): string {
  const [year, month, day] = key.split('-').map(Number) as [number, number, number];
  const date = new Date(year, month - 1, day);
  const days = Math.round((startOfDay(now) - date.getTime()) / DAY);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (year === now.getFullYear()) {
    return date.toLocaleDateString(PANEL_LOCALE, { weekday: 'long', month: 'short', day: 'numeric' });
  }
  return date.toLocaleDateString(PANEL_LOCALE, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export type PanelFileKind = 'image' | 'pdf' | 'sheet' | 'doc' | 'slides' | 'archive' | 'media' | 'text' | 'other';

export function panelFileKind(mime: string, name = ''): PanelFileKind {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (mime.includes('spreadsheet') || mime.includes('excel') || mime === 'text/csv' || ['xls', 'xlsx', 'csv'].includes(ext))
    return 'sheet';
  if (mime.includes('presentation') || mime.includes('powerpoint') || ['ppt', 'pptx'].includes(ext)) return 'slides';
  if (mime.includes('word') || ['doc', 'docx'].includes(ext)) return 'doc';
  if (mime.includes('zip') || ['zip', 'rar', '7z'].includes(ext)) return 'archive';
  if (mime.startsWith('video/') || mime.startsWith('audio/')) return 'media';
  if (mime.startsWith('text/') || mime === 'application/json') return 'text';
  return 'other';
}

/** Short uppercase extension badge ("PDF", "XLSX"), falling back to the kind. */
export function fileExtension(name: string): string {
  const parts = name.split('.');
  if (parts.length < 2) return '';
  return (parts.pop() ?? '').slice(0, 4).toUpperCase();
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
