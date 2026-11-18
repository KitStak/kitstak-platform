import { OG_CONTENT_TYPE, OG_SIZE, ogImage } from '@/lib/og-image';

export const alt = 'KitStak. The whole operation on one stack.';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogImage({ brand: 'kitstak', promise: 'The whole operation on one stack.', address: 'kitstak.com' });
}
