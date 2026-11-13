/**
 * Pure helpers for the task detail (no React, no server): duration parsing for time entries,
 * timer clocks, file sizes, comment mention encoding and markdown selection wrapping.
 */
import { mentionToken } from '@/lib/mentions';

/**
 * Minutes from what people type: "90", "1h", "1h 30m", "1.5h", "45m", "2:15", "1 hour 5 mins".
 * Returns null when the text is not a duration.
 */
export function parseDuration(text: string): number | null {
  const raw = text.trim().toLowerCase();
  if (!raw) return null;
  const clock = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (clock) {
    const minutes = Number(clock[1]) * 60 + Number(clock[2]);
    return Number(clock[2]) < 60 && minutes > 0 ? minutes : null;
  }
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const minutes = Math.round(Number(raw));
    return minutes > 0 ? minutes : null;
  }
  const pattern = /(\d+(?:\.\d+)?)\s*(hours|hour|hrs|hr|h|minutes|minute|mins|min|m)(?![a-z])/g;
  let total = 0;
  let consumed = '';
  for (const match of raw.matchAll(pattern)) {
    const value = Number(match[1]);
    total += match[2].startsWith('h') ? value * 60 : value;
    consumed += match[0];
  }
  // Everything except whitespace must have been understood.
  if (!consumed || raw.replace(/\s+/g, '').length !== consumed.replace(/\s+/g, '').length) return null;
  const minutes = Math.round(total);
  return minutes > 0 ? minutes : null;
}

/** Live timer clock "0:04:09" / "1:02:33" from elapsed milliseconds. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** 1536 → "1.5 KB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${Math.max(0, Math.round(bytes || 0))} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`;
}

export function isImageType(contentType: string): boolean {
  return /^image\/(png|jpe?g|gif|webp|avif|svg\+xml|bmp)$/i.test(contentType);
}

/** Short friendly kind for a file ("PDF", "Spreadsheet", "Image"…). */
export function fileKind(name: string, contentType: string): string {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  if (isImageType(contentType)) return 'Image';
  if (contentType === 'application/pdf' || ext === 'pdf') return 'PDF';
  if (['xls', 'xlsx', 'csv', 'numbers', 'ods'].includes(ext)) return 'Spreadsheet';
  if (['doc', 'docx', 'pages', 'odt', 'rtf', 'txt', 'md'].includes(ext)) return 'Document';
  if (['ppt', 'pptx', 'key', 'odp'].includes(ext)) return 'Slides';
  if (['zip', 'rar', '7z', 'gz', 'tar'].includes(ext)) return 'Archive';
  if (contentType.startsWith('video/')) return 'Video';
  if (contentType.startsWith('audio/')) return 'Audio';
  return ext ? ext.toUpperCase() : 'File';
}

export interface PendingMention {
  readonly name: string;
  readonly id: string;
}

/**
 * The composer shows "@Maya Lopez"; on send each picked mention becomes the stored token
 * `@[Maya Lopez](user:<id>)`. Longest names first so "@Ann Lee" does not eat "@Ann Leeds".
 */
export function encodeMentions(text: string, mentions: readonly PendingMention[]): string {
  const unique = [...new Map(mentions.map((entry) => [entry.name, entry])).values()].sort(
    (a, b) => b.name.length - a.name.length,
  );
  let out = text;
  for (const mention of unique) {
    const escaped = mention.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(
      new RegExp(`(^|[^\\w\\]])@${escaped}(?![\\w])`, 'g'),
      (_all, lead: string) => `${lead}${mentionToken(mention.name, mention.id)}`,
    );
  }
  return out;
}

/** Inverse of encodeMentions, for editing an existing comment. */
export function decodeMentions(body: string): { text: string; mentions: PendingMention[] } {
  const mentions: PendingMention[] = [];
  const text = body.replace(
    /@\[([^\]\n]{1,80})\]\(user:([0-9a-f-]{36})\)/gi,
    (_all, name: string, id: string) => {
      mentions.push({ name, id: id.toLowerCase() });
      return `@${name}`;
    },
  );
  return { text, mentions };
}

/** The "@query" being typed right before the caret, if any. */
export function mentionQueryAt(text: string, caret: number): { query: string; start: number } | null {
  const before = text.slice(0, caret);
  const match = /(^|\s)@([\p{L}\p{N}._-]{0,30})$/u.exec(before);
  if (!match) return null;
  return { query: match[2], start: caret - match[2].length - 1 };
}

export interface TextEdit {
  readonly text: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
}

/** Wrap the selection in markdown markers (toggles off when already wrapped). */
export function wrapSelection(
  text: string,
  start: number,
  end: number,
  marker: string,
  placeholder = 'text',
): TextEdit {
  const selected = text.slice(start, end);
  const before = text.slice(0, start);
  const after = text.slice(end);
  if (before.endsWith(marker) && after.startsWith(marker)) {
    return {
      text: before.slice(0, -marker.length) + selected + after.slice(marker.length),
      selectionStart: start - marker.length,
      selectionEnd: end - marker.length,
    };
  }
  const inner = selected || placeholder;
  return {
    text: before + marker + inner + marker + after,
    selectionStart: start + marker.length,
    selectionEnd: start + marker.length + inner.length,
  };
}

/** Prefix every selected line (lists, quotes). */
export function prefixLines(
  text: string,
  start: number,
  end: number,
  prefix: (index: number) => string,
): TextEdit {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const lineEndIndex = text.indexOf('\n', end);
  const lineEnd = lineEndIndex === -1 ? text.length : lineEndIndex;
  const lines = text.slice(lineStart, lineEnd).split('\n');
  const already = lines.every((line, index) => line.startsWith(prefix(index)));
  const next = lines
    .map((line, index) => (already ? line.slice(prefix(index).length) : prefix(index) + line))
    .join('\n');
  const out = text.slice(0, lineStart) + next + text.slice(lineEnd);
  return { text: out, selectionStart: lineStart, selectionEnd: lineStart + next.length };
}

/** Insert a markdown link around the selection. */
export function insertLink(text: string, start: number, end: number, url: string): TextEdit {
  const label = text.slice(start, end) || url;
  const snippet = `[${label}](${url})`;
  return {
    text: text.slice(0, start) + snippet + text.slice(end),
    selectionStart: start + snippet.length,
    selectionEnd: start + snippet.length,
  };
}

/** Rank people for the @mention popup: prefix of full name > prefix of any word > email > substring. */
export function rankPeople<T extends { readonly name: string; readonly email: string }>(
  people: readonly T[],
  query: string,
  limit = 8,
): T[] {
  const q = query.trim().toLowerCase();
  return people
    .map((person) => {
      const name = person.name.toLowerCase();
      const email = person.email.toLowerCase();
      let score = -1;
      if (!q) score = 1;
      else if (name.startsWith(q)) score = 4;
      else if (name.split(/\s+/).some((word) => word.startsWith(q))) score = 3;
      else if (email.startsWith(q)) score = 2;
      else if (name.includes(q) || email.includes(q)) score = 1;
      return { person, score };
    })
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score || a.person.name.localeCompare(b.person.name))
    .slice(0, limit)
    .map((entry) => entry.person);
}
