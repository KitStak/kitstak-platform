const SLUG_MAX = 48;

/** URL-safe org slug from a display name ('Acme Inc.' → 'acme-inc'). */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, '');
  return slug || 'workspace';
}

/** A short random suffix for slug collisions ('acme-inc' → 'acme-inc-x7k2'). */
export function slugWithSuffix(base: string): string {
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${base.slice(0, SLUG_MAX - 5)}-${suffix}`;
}
