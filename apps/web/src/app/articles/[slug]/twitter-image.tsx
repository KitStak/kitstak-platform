/** Same card as the Open Graph image. Next needs the settings declared in this file too. */
import { OG_CONTENT_TYPE, OG_SIZE } from '@/lib/og-image';
import Image, { alt as ogAlt, generateStaticParams } from './opengraph-image';

export const alt = ogAlt;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export { generateStaticParams };

export default Image;
