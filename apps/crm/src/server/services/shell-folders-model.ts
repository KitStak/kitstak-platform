/** Client-safe folder extras (shell module): the folder icon set and metadata helpers. */
export const FOLDER_ICONS = [
  'folder',
  'briefcase',
  'target',
  'rocket',
  'star',
  'heart',
  'flag',
  'trophy',
  'users',
  'building',
  'globe',
  'megaphone',
  'chart',
  'calendar',
  'lightbulb',
  'package',
] as const;
export type FolderIcon = (typeof FOLDER_ICONS)[number];

export function isFolderIcon(value: unknown): value is FolderIcon {
  return typeof value === 'string' && (FOLDER_ICONS as readonly string[]).includes(value);
}

function parseObject(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Folder ids → icon, read from org metadata JSON (`shell.folderIcons`); unknown values dropped. */
export function readFolderIcons(metadata: string | null | undefined): Record<string, FolderIcon> {
  const shell = parseObject(metadata).shell;
  const icons = typeof shell === 'object' && shell !== null ? (shell as { folderIcons?: unknown }).folderIcons : null;
  if (typeof icons !== 'object' || icons === null) return {};
  return Object.fromEntries(
    Object.entries(icons as Record<string, unknown>).filter((entry): entry is [string, FolderIcon] =>
      isFolderIcon(entry[1]),
    ),
  );
}

/** New metadata JSON with one folder icon set (null removes it); every other key is preserved. */
export function writeFolderIcon(
  metadata: string | null | undefined,
  folderId: string,
  icon: FolderIcon | null,
): string {
  const root = parseObject(metadata);
  const shell = typeof root.shell === 'object' && root.shell !== null ? (root.shell as Record<string, unknown>) : {};
  const rest = Object.fromEntries(Object.entries(readFolderIcons(metadata)).filter(([id]) => id !== folderId));
  const folderIcons = icon ? { ...rest, [folderId]: icon } : rest;
  return JSON.stringify({ ...root, shell: { ...shell, folderIcons } });
}
