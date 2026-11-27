import { OG_CONTENT_TYPE, OG_SIZE, ogImage } from '@/lib/og-image';

export const alt = 'KitStak articles. Run a tighter floor.';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogImage({ brand: 'kitstak', promise: 'Run a tighter floor.', address: 'kitstak.com/articles' });
}
