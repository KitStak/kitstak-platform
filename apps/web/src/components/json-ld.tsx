import { serializeJsonLd } from '@/lib/seo';

/**
 * Structured data for search engines, rendered into the static HTML. The payload is built from
 * our own constants and escaped by `serializeJsonLd`, so no string can close the tag.
 */
export function JsonLd({ data }: { readonly data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}
