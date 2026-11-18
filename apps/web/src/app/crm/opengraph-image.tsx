import { OG_CONTENT_TYPE, OG_SIZE, ogImage } from '@/lib/og-image';

export const alt = 'KitStak CRM. Pipelines, boards and automations your team shapes.';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogImage({
    brand: 'kitstak',
    app: { id: 'crm', name: 'KitStak CRM' },
    promise: 'Pipelines, boards and automations your team shapes.',
    address: 'kitstak.com/crm',
  });
}
