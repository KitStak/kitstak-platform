import { OG_CONTENT_TYPE, OG_SIZE, ogImage } from '@/lib/og-image';

export const alt = 'KitStak customers. Real teams, real moves.';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogImage({ brand: 'kitstak', promise: 'Real teams. Real moves.', address: 'kitstak.com/customers' });
}
