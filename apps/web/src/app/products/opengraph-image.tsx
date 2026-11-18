import { OG_CONTENT_TYPE, OG_SIZE, ogImage } from '@/lib/og-image';

export const alt = 'KitStak products. Four products, one stack.';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogImage({ brand: 'kitstak', promise: 'Four products. One stack.', address: 'kitstak.com/products' });
}
