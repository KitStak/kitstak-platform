import type { MetadataRoute } from 'next';

const BASE = 'https://kitstak.com';

const PAGES: readonly { readonly path: string; readonly priority: number }[] = [
  { path: '', priority: 1 },
  { path: '/products', priority: 0.9 },
  { path: '/wms', priority: 0.9 },
  { path: '/crm', priority: 0.9 },
  { path: '/projects', priority: 0.9 },
  { path: '/get-started', priority: 0.8 },
  { path: '/contact', priority: 0.6 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map((page) => ({ url: `${BASE}${page.path}`, changeFrequency: 'monthly', priority: page.priority }));
}
