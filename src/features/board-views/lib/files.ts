/** File gallery helpers: type classification, colors, filtering and sorting. */
import type { LabelColor } from '@/components/ui/label-color';
import type { FileDto } from '@/server/services/contracts/dto';

export type FileKind = 'image' | 'pdf' | 'doc' | 'sheet' | 'slides' | 'archive' | 'media' | 'other';

export function fileKind(file: Pick<FileDto, 'mime' | 'name'>): FileKind {
  const mime = file.mime.toLowerCase();
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (/spreadsheet|excel|csv/.test(mime) || ['xls', 'xlsx', 'csv', 'numbers'].includes(ext)) return 'sheet';
  if (/presentation|powerpoint/.test(mime) || ['ppt', 'pptx', 'key'].includes(ext)) return 'slides';
  if (/word|document|text\//.test(mime) || ['doc', 'docx', 'txt', 'md', 'rtf'].includes(ext)) return 'doc';
  if (/zip|compressed|tar|rar/.test(mime) || ['zip', 'rar', '7z', 'gz'].includes(ext)) return 'archive';
  if (mime.startsWith('video/') || mime.startsWith('audio/')) return 'media';
  return 'other';
}

export const KIND_COLOR: Readonly<Record<FileKind, LabelColor>> = {
  image: 'sky',
  pdf: 'red',
  doc: 'blue',
  sheet: 'green',
  slides: 'orange',
  archive: 'yellow',
  media: 'purple',
  other: 'gray',
};

export const KIND_LABEL: Readonly<Record<FileKind, string>> = {
  image: 'Image',
  pdf: 'PDF',
  doc: 'Document',
  sheet: 'Spreadsheet',
  slides: 'Presentation',
  archive: 'Archive',
  media: 'Media',
  other: 'File',
};

export type KindFilter = 'all' | 'image' | 'pdf' | 'doc' | 'sheet' | 'other';

export function matchesKind(file: FileDto, filter: KindFilter): boolean {
  if (filter === 'all') return true;
  const kind = fileKind(file);
  if (filter === 'other') return !['image', 'pdf', 'doc', 'sheet'].includes(kind);
  return kind === filter;
}

export function filterFiles(
  files: readonly FileDto[],
  options: { query: string; kind: KindFilter; sort: 'newest' | 'oldest' | 'name' | 'size'; itemNames: ReadonlyMap<string, string> },
): FileDto[] {
  const needle = options.query.trim().toLowerCase();
  const list = files.filter((file) => {
    if (!matchesKind(file, options.kind)) return false;
    if (!needle) return true;
    const itemName = file.itemId ? (options.itemNames.get(file.itemId) ?? '') : '';
    return `${file.name} ${itemName}`.toLowerCase().includes(needle);
  });
  const sorters: Record<typeof options.sort, (a: FileDto, b: FileDto) => number> = {
    newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
    oldest: (a, b) => a.createdAt.localeCompare(b.createdAt),
    name: (a, b) => a.name.localeCompare(b.name),
    size: (a, b) => b.size - a.size,
  };
  return list.sort(sorters[options.sort]);
}

export function formatBytes(bytes: number): string {
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

export function extensionOf(name: string): string {
  const ext = name.includes('.') ? name.split('.').pop() : '';
  return (ext ?? '').slice(0, 4).toUpperCase();
}
