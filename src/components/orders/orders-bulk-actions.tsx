"use client";

import { ChevronDown, Printer, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dropdown, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown";

export interface OrdersBulkActionsProps {
  selectedCount: number;
}

/**
 * Contextual bulk actions for the Shipment Orders grid.
 * Disabled until at least one row is selected — matching Logiwa's toolbar.
 */
export function OrdersBulkActions({ selectedCount }: OrdersBulkActionsProps) {
  const disabled = selectedCount === 0;

  return (
    <>
      <Button variant="secondary" disabled={disabled}>
        <Printer className="h-3.5 w-3.5" aria-hidden />
        Print Labels
      </Button>

      {disabled ? (
        <Button variant="secondary" disabled aria-haspopup="menu">
          Warehouse Ops
          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
        </Button>
      ) : (
        <Dropdown
          align="end"
          trigger={(open) => (
            <Button
              variant="secondary"
              aria-haspopup="menu"
              aria-expanded={open}
              className={cn(open && "border-primary text-primary")}
            >
              Warehouse Ops
              <ChevronDown
                className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
                aria-hidden
              />
            </Button>
          )}
        >
          {(close) => (
            <>
              <DropdownItem onClick={close}>Create picking job</DropdownItem>
              <DropdownItem onClick={close}>Create packing job</DropdownItem>
              <DropdownItem onClick={close}>Allocate inventory</DropdownItem>
              <DropdownSeparator />
              <DropdownItem onClick={close}>Put on hold</DropdownItem>
            </>
          )}
        </Dropdown>
      )}

      <Button
        variant="secondary"
        disabled={disabled}
        className={cn(
          disabled
            ? "border-slate-200 text-slate-400 disabled:pointer-events-auto disabled:cursor-not-allowed"
            : "text-danger hover:border-danger/40 hover:bg-danger-soft hover:text-danger"
        )}
      >
        <XCircle className="h-3.5 w-3.5" aria-hidden />
        Cancel Orders
      </Button>

      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
    </>
  );
}
