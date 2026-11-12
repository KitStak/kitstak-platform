'use client';

/** `/receiving/new` — Create purchase order (5-step linear wizard). */
import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ChevronLeft, X } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useMe } from '@/lib/permissions-client';
import { PoWizard } from './wizard/po-wizard';

export function PoCreatePage() {
  const me = useMe();
  const [round, setRound] = React.useState(0);
  const [created, setCreated] = React.useState(false);
  const opts = me.data?.data.contextOptions;
  const ctx = me.data?.data.context;
  // ?warehouseId=&clientId= prefill (Kit Component Reorder Quantity drill); scope-checked below.
  const params = useSearchParams();
  const qWarehouse = params.get('warehouseId');
  const qClient = params.get('clientId');
  // Prefill from the working context, else when the user has exactly one warehouse / client in scope.
  const defaults = React.useMemo(() => {
    const inScope = (list: readonly { readonly id: string }[] | undefined, id: string | null | undefined) =>
      id && list?.some((o) => o.id === id) ? id : null;
    return {
      warehouseId:
        inScope(opts?.warehouses, qWarehouse) ??
        inScope(opts?.warehouses, ctx?.warehouseId) ??
        (opts?.warehouses.length === 1 ? (opts.warehouses[0]?.id ?? null) : null),
      clientId:
        inScope(opts?.clients, qClient) ??
        inScope(opts?.clients, ctx?.clientId) ??
        (opts?.clients.length === 1 ? (opts.clients[0]?.id ?? null) : null),
    };
  }, [opts, ctx, qWarehouse, qClient]);
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader
        title={created ? 'Purchase order created' : 'Create purchase order'}
        helper={
          created
            ? 'The order is Pending. Receive it from its detail page when the goods arrive.'
            : "Order products from a vendor. You'll receive them against this purchase order."
        }
        actions={
          <>
            <Link href="/receiving" className={buttonVariants({ variant: 'ghost' })}>
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
              Purchase orders
            </Link>
            {created ? null : (
              <Link href="/receiving" className={buttonVariants({ variant: 'secondary' })}>
                <X className="h-3.5 w-3.5" aria-hidden />
                Cancel order
              </Link>
            )}
          </>
        }
      />
      <div className="px-6">
        {me.isPending ? (
          <div className="flex flex-col gap-5" aria-busy aria-label="Loading">
            <Skeleton className="h-14 w-full" />
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
              <Skeleton className="h-[420px]" />
              <Skeleton className="h-[320px]" />
            </div>
          </div>
        ) : (
          <PoWizard
            key={round}
            po={null}
            defaults={defaults}
            onCreated={() => setCreated(true)}
            onCreateAnother={() => {
              setCreated(false);
              setRound((r) => r + 1);
            }}
          />
        )}
      </div>
    </div>
  );
}
