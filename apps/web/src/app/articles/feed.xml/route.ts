import { ARTICLES } from '@/components/articles/articles-content';
import { SITE_URL, absoluteUrl } from '@/lib/seo';

export const dynamic = 'force-static';

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The RSS feed of every article, newest first, for readers and for search engines. */
export function GET(): Response {
  const items = [...ARTICLES]
    .sort((a, b) => b.published.localeCompare(a.published))
    .map((a) => {
      const url = absoluteUrl(`/articles/${a.slug}`);
      return `    <item>
      <title>${escape(a.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <category>${escape(a.category)}</category>
      <pubDate>${new Date(`${a.published}T12:00:00Z`).toUTCString()}</pubDate>
      <description>${escape(a.description)}</description>
    </item>`;
    })
    .join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>KitStak articles</title>
    <link>${SITE_URL}/articles</link>
    <atom:link href="${SITE_URL}/articles/feed.xml" rel="self" type="application/rss+xml" />
    <description>Field notes for warehouses, 3PLs and operations teams.</description>
    <language>en-us</language>
${items}
  </channel>
</rss>
`;
  return new Response(xml, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
}
