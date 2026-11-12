/** F8.2 shared placeholder title; grep / critic audits count pages by this exact string. */
export const PLACEHOLDER_TITLE = "Module in progress";
export const PLACEHOLDER_COPY = "This screen is being built. Bookmarks to it will keep working.";

/** "Ships in M14" — names the owning module so placeholders can be counted per module. */
export function shipsInLabel(owner: string): string {
  return /^M\d+/i.test(owner) ? `Ships in ${owner.toUpperCase()}` : `Ships with ${owner}`;
}
