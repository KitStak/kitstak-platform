"use client";

/** `/receiving/new` — Create purchase order (5-step linear wizard). */
import * as React from "react";
import Link from "next/link";
import { ChevronLeft, X } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { useMe } from "@/lib/permissions-client";
import { PoWizard } from "./wizard/po-wizard";

export function PoCreatePage() {
  const me = useMe();
  const [round, setRound] = React.useState(0);
  const opts = me.data?.data.contextOptions;
  // Prefill when the user has exactly one warehouse / client in scope.
  const defaults = React.useMemo(() => ({
    warehouseId: opts?.warehouses.length === 1 ? opts.warehouses[0]?.id ?? null : null,
    clientId: opts?.clients.length === 1 ? opts.clients[0]?.id ?? null : null,
  }), [opts]);
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader
        title="Create purchase order"
        helper="Order products from a vendor. You'll receive them against this purchase order."
        actions={
          <>
            <Link href="/receiving" className={buttonVariants({ variant: "ghost" })}>
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
              Purchase orders
            </Link>
            <Link href="/receiving" className={buttonVariants({ variant: "secondary" })}>
              <X className="h-3.5 w-3.5" aria-hidden />
              Cancel order
            </Link>
          </>
        }
      />
      {me.isPending ? null : <PoWizard key={round} po={null} defaults={defaults} onCreateAnother={() => setRound((r) => r + 1)} />}
    </div>
  );
}
