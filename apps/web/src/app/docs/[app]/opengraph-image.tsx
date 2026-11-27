import { docApp, docApps } from '@/lib/docs/docs';
import { OG_CONTENT_TYPE, OG_SIZE, ogImage } from '@/lib/og-image';

export const alt = 'KitStak docs';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export function generateStaticParams() {
  return docApps().map((app) => ({ app: app.id }));
}

/** One card per app. Every page under /docs/<app> shares it. */
export default async function Image({ params }: { readonly params: Promise<{ app: string }> }) {
  const { app: id } = await params;
  const app = docApp(id);
  return ogImage({
    brand: 'kitstak',
    promise: `${app?.title ?? 'KitStak'} docs.`,
    address: `kitstak.com/docs/${id}`,
  });
}
