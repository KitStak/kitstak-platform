import { OG_CONTENT_TYPE, OG_SIZE, ogImage } from '@/lib/og-image';

export const alt = 'Team 1 customer story. 28 boards moved in one day.';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogImage({
    brand: 'kitstak',
    promise: 'Team 1. Two tools to one stack.',
    address: 'kitstak.com/customers/team-1',
  });
}
