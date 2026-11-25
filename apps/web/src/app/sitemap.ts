import type { MetadataRoute } from 'next';
import { ARTICLES } from '@/components/articles/articles-content';
import { SITE_URL } from '@/lib/seo';

/** The day the pages below last changed in a way a reader would notice. Bump it with real edits. */
const SITE_UPDATED = '2026-11-25';

type Freq = NonNullable<MetadataRoute.Sitemap[number]['changeFrequency']>;

const PAGES: readonly { readonly path: string; readonly priority: number; readonly changeFrequency: Freq }[] =
  [
    { path: '', priority: 1, changeFrequency: 'weekly' },
    { path: '/products', priority: 0.9, changeFrequency: 'monthly' },
    { path: '/wms', priority: 0.9, changeFrequency: 'monthly' },
    { path: '/crm', priority: 0.9, changeFrequency: 'monthly' },
    { path: '/projects', priority: 0.9, changeFrequency: 'monthly' },
    { path: '/pulse', priority: 0.9, changeFrequency: 'monthly' },
    { path: '/pricing', priority: 0.9, changeFrequency: 'monthly' },
    { path: '/customers', priority: 0.7, changeFrequency: 'monthly' },
    { path: '/customers/team-1', priority: 0.8, changeFrequency: 'monthly' },
    { path: '/articles', priority: 0.8, changeFrequency: 'weekly' },
    { path: '/get-started', priority: 0.8, changeFrequency: 'monthly' },
    { path: '/security', priority: 0.6, changeFrequency: 'monthly' },
    { path: '/contact', priority: 0.6, changeFrequency: 'yearly' },
    { path: '/terms', priority: 0.3, changeFrequency: 'yearly' },
    { path: '/privacy', priority: 0.3, changeFrequency: 'yearly' },
  ];

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    ...PAGES.map((page) => ({
      url: `${SITE_URL}${page.path}`,
      lastModified: SITE_UPDATED,
      changeFrequency: page.changeFrequency,
      priority: page.priority,
    })),
    ...ARTICLES.map((article) => ({
      url: `${SITE_URL}/articles/${article.slug}`,
      lastModified: article.updated,
      changeFrequency: 'monthly' as const,
      priority: 0.7,
    })),
  ];
}
