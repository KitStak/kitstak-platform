import { isAppLive } from '@/components/site-links';
import { OG_CONTENT_TYPE, OG_SIZE, ogImage } from '@/lib/og-image';

export const alt = `KitStak Crew. Staff it. Clock it. Plan it.${isAppLive('crew') ? '' : ' Coming soon.'}`;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogImage({
    brand: 'kitstak',
    app: { id: 'crew', name: 'KitStak Crew' },
    promise: 'Staff it. Clock it. Plan it.',
    address: 'kitstak.com/crew',
  });
}
