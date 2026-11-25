import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo';

/**
 * Every page on kitstak.com is public and meant to be found, by search engines and by AI
 * assistants alike. Nothing is blocked: Google needs the scripts and styles under /_next to render
 * a page, and links with a cart in the query carry a canonical tag back to the clean page.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/' }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
