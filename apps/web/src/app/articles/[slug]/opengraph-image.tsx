import { ARTICLES, articleBySlug } from '@/components/articles/articles-content';
import { OG_CONTENT_TYPE, OG_SIZE, ogImage } from '@/lib/og-image';

export const alt = 'A KitStak article';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export function generateStaticParams() {
  return ARTICLES.map((article) => ({ slug: article.slug }));
}

export default async function Image({ params }: { readonly params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const article = articleBySlug(slug);
  return ogImage({
    brand: 'kitstak',
    promise: article?.ogLine ?? 'Run a tighter floor.',
    address: `kitstak.com/articles/${slug}`,
  });
}
