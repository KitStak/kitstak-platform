import { RecordDetailSkeleton } from '@/components/layout/shell-skeleton';

/**
 * Purchase order detail streams with a skeleton that mirrors the real page (header +
 * helper, step strip, wizard column + right rail) so the route never paints blank.
 */
export default function PoDetailLoading() {
  return <RecordDetailSkeleton />;
}
