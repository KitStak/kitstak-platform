/** Clipboard → cell value parsing for simple column types. Pure. */
import type { CellCommitValue } from '@/features/cells';
import type { ColumnDto } from '@/server/services/contracts/dto';

/** Parse pasted text into a cell value for simple column types (null = unsupported). */
export function parsePaste(
  column: ColumnDto,
  text: string,
): { ok: true; value: CellCommitValue } | { ok: false } {
  const value =
    text
      .replace(/\r?\n$/, '')
      .split(/\r?\n/)[0]
      ?.split('\t')[0]
      ?.trim() ?? '';
  switch (column.type) {
    case 'text':
    case 'long_text':
      return { ok: true, value: value || null };
    case 'number': {
      const parsed = Number(value.replace(/[,\s$%€£]/g, ''));
      return value && Number.isFinite(parsed) ? { ok: true, value: parsed } : { ok: false };
    }
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? { ok: true, value: { email: value } } : { ok: false };
    case 'link':
      return /^https?:\/\//i.test(value) ? { ok: true, value: { url: value } } : { ok: false };
    case 'phone':
      return value ? { ok: true, value: { phone: value } } : { ok: false };
    case 'checkbox':
      return { ok: true, value: /^(true|yes|1|checked|x)$/i.test(value) };
    default:
      return { ok: false };
  }
}
