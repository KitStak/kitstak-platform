import { OG_CONTENT_TYPE, OG_SIZE, ogImage } from '@/lib/og-image';

export const alt = 'KitStak Pulse. Know which jobs make money.';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogImage({ brand: 'pulse', promise: 'Know which jobs make money.', address: 'kitstak.com/pulse' });
}
