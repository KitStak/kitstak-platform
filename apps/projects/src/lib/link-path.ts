/**
 * Pure helpers for sibling-app link paths (see server/integrations/link-url.ts).
 * `linkPathOf` keeps only path, query and hash of a URL, so a stored link never pins a host.
 */
export type SiblingApp = 'crm' | 'wms';

export function siblingAppOf(targetType: string): SiblingApp | null {
  if (targetType.startsWith('crm_')) return 'crm';
  if (targetType.startsWith('wms_')) return 'wms';
  return null;
}

export function linkPathOf(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('/')) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}` || '/';
  } catch {
    return null;
  }
}
