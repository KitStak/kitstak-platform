import { OG_CONTENT_TYPE, OG_SIZE, ogImage } from '@/lib/og-image';

export const alt = 'KitStak Projects. Plans, tasks and timelines on the same stack.';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogImage({
    brand: 'kitstak',
    app: { id: 'projects', name: 'KitStak Projects' },
    promise: 'Plans, tasks and timelines on the same stack.',
    address: 'kitstak.com/projects',
  });
}
