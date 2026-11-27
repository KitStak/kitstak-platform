import { OG_CONTENT_TYPE, OG_SIZE, ogImage } from '@/lib/og-image';

export const alt = 'KitStak pricing. Simple prices. Pay only for the apps you use.';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogImage({ brand: 'kitstak', promise: 'Pay only for the apps you use.', address: 'kitstak.com/pricing' });
}
