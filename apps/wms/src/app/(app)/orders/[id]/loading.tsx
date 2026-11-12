import { RecordDetailSkeleton } from '@/components/layout/shell-skeleton';

/**
 * Order detail streams with a skeleton that mirrors the real page (header + helper,
 * tab strip, main column + right rail), not the generic list grid.
 */
export default function OrderDetailLoading() {
  return <RecordDetailSkeleton />;
}
