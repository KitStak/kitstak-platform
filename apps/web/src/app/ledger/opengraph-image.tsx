import { OG_CONTENT_TYPE, OG_SIZE, ogImage } from '@/lib/og-image';

export const alt = 'KitStak Ledger. Bill it. Pay it. Close it. Coming soon.';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogImage({
    brand: 'kitstak',
    app: { id: 'ledger', name: 'KitStak Ledger' },
    promise: 'Bill it. Pay it. Close it.',
    address: 'kitstak.com/ledger',
  });
}
