'use client';

/** Header "Reports" menu shared by the inventory views: every ledger/snapshot report one click away. */
import * as React from 'react';
import { ChevronDown, FileBarChart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export const INVENTORY_REPORT_LINKS: readonly { readonly href: string; readonly label: string }[] = [
  { href: '/reports/transaction-history', label: 'Transaction History' },
  { href: '/reports/inventory-snapshot', label: 'Inventory Snapshot' },
  { href: '/reports/serial-numbers', label: 'Serial Number Report' },
  { href: '/reports/transaction-history/serial', label: 'Serial Number Transaction History' },
  { href: '/reports/order-inventory', label: 'Order Inventory' },
  { href: '/reports/replenishment', label: 'Dynamic Replenishment' },
  { href: '/reports/inventory-aging', label: 'Inventory Aging' },
];

export function InventoryReportsMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary">
          <FileBarChart className="h-3.5 w-3.5" aria-hidden />
          Reports
          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[240px]">
        {INVENTORY_REPORT_LINKS.map((r) => (
          <DropdownMenuItem key={r.href} href={r.href}>
            {r.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
