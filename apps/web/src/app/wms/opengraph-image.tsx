import { OG_CONTENT_TYPE, OG_SIZE, ogImage } from '@/lib/og-image';

export const alt = 'KitStak WMS. Warehouse management from the dock to the door.';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogImage({
    brand: 'kitstak',
    app: { id: 'wms', name: 'KitStak WMS' },
    promise: 'Warehouse management from the dock to the door.',
    address: 'kitstak.com/wms',
  });
}
