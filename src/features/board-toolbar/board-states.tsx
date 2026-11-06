'use client';

/** Whole-page skeleton (matches the final layout: header, tabs, toolbar, groups) and error states. */
import Link from 'next/link';
import { Lock, RotateCw } from 'lucide-react';
import { Button, EmptyState, Skeleton, buttonVariants } from '@/components/ui';

export function CanvasSkeleton() {
  return (
    <div className="flex flex-col gap-6 px-8 pt-4 max-md:px-4" aria-hidden>
      {[6, 4].map((rows, group) => (
        <div key={group} className="flex flex-col gap-1">
          <Skeleton width={160} height={18} rounded="full" className="mb-2" />
          {Array.from({ length: rows }, (_, index) => (
            <div key={index} className="flex h-9 items-center gap-2 border-b border-border-subtle">
              <span className="h-full w-1.5 rounded-l-xs bg-skeleton" />
              <Skeleton width="28%" height={12} rounded="full" />
              <Skeleton width={96} height={24} rounded="sm" className="ml-auto" />
              <Skeleton width={28} height={28} rounded="full" />
              <Skeleton width={120} height={12} rounded="full" className="max-sm:hidden" />
              <Skeleton width={88} height={12} rounded="full" className="max-md:hidden" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function BoardPageSkeleton() {
  return (
    <div className="flex h-full flex-col" aria-busy="true" aria-label="Loading board" data-skeleton data-testid="board-skeleton">
      <div className="flex flex-col gap-2 px-8 pt-4 pb-2 max-md:px-4">
        <Skeleton width={180} height={10} rounded="full" />
        <div className="flex h-12 items-center gap-3">
          <Skeleton width={32} height={32} rounded="md" />
          <Skeleton width={240} height={22} rounded="full" />
          <div className="ml-auto flex gap-2">
            <Skeleton width={84} height={32} rounded="sm" className="max-md:hidden" />
            <Skeleton width={84} height={32} rounded="sm" />
            <Skeleton width={32} height={32} rounded="sm" />
          </div>
        </div>
      </div>
      <div className="flex h-10 items-center gap-3 border-b border-border-subtle px-8 max-md:px-4">
        <Skeleton width={96} height={14} rounded="full" />
        <Skeleton width={72} height={14} rounded="full" />
        <Skeleton width={84} height={14} rounded="full" />
      </div>
      <div className="flex h-12 items-center gap-2 px-8 max-md:px-4">
        <Skeleton width={116} height={32} rounded="sm" />
        <Skeleton width={200} height={28} rounded="sm" className="max-sm:hidden" />
        <Skeleton width={72} height={28} rounded="sm" />
        <Skeleton width={72} height={28} rounded="sm" />
      </div>
      <CanvasSkeleton />
    </div>
  );
}

export function BoardNoAccess({
  homeHref,
  title = "This board doesn't exist or you don't have access",
  description = "It may have been deleted, or it's private. Ask a board owner to invite you.",
}: {
  readonly homeHref: string;
  readonly title?: string;
  readonly description?: string;
}) {
  return (
    <div className="flex h-full items-center justify-center p-8" data-testid="board-no-access">
      <EmptyState
        visual={
          <span className="flex size-12 items-center justify-center rounded-full bg-muted">
            <Lock aria-hidden className="size-6 text-icon" />
          </span>
        }
        title={title}
        description={description}
        actions={
          <Link href={homeHref} className={buttonVariants({ variant: 'primary' })}>
            Go to home
          </Link>
        }
      />
    </div>
  );
}

export function BoardLoadError({ onRetry, retrying }: { readonly onRetry: () => void; readonly retrying: boolean }) {
  return (
    <div className="flex h-full items-center justify-center p-8" data-testid="board-error">
      <EmptyState
        illustration="error"
        title="We couldn't load this board"
        description="Check your connection and try again. Your data is safe."
        actions={
          <Button variant="secondary" leadingIcon={<RotateCw />} onClick={onRetry} loading={retrying}>
            Try again
          </Button>
        }
      />
    </div>
  );
}

/** Shown in the item panel's place while a new item is being created (opens on the real id). */
export function NewItemPlaceholder({ noun }: { readonly noun: string }) {
  return (
    <aside
      role="status"
      aria-live="polite"
      aria-label={`Creating ${noun.toLowerCase()}`}
      data-testid="new-item-placeholder"
      className="fixed top-0 right-0 bottom-0 z-[var(--z-modal)] flex w-[min(640px,100vw)] flex-col gap-4 border-l border-border-subtle bg-raised p-6 shadow-modal animate-slide-in-right"
    >
      <span className="sr-only">Creating {noun.toLowerCase()}…</span>
      <Skeleton width={140} height={10} rounded="full" />
      <Skeleton width="60%" height={24} rounded="full" />
      <div className="flex gap-2">
        <Skeleton width={84} height={28} rounded="sm" />
        <Skeleton width={84} height={28} rounded="sm" />
        <Skeleton width={84} height={28} rounded="sm" />
      </div>
      <div className="mt-2 flex flex-col gap-3">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex items-center gap-3">
            <Skeleton width={120} height={12} rounded="full" />
            <Skeleton width="45%" height={28} rounded="sm" />
          </div>
        ))}
      </div>
    </aside>
  );
}
