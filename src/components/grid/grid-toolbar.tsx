"use client";

import * as React from "react";
import { ListFilter, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dropdown } from "@/components/ui/dropdown";

export function GridSearch({
  value,
  onChange,
  placeholder = "Search by code",
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint"
        aria-hidden
      />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-8 w-60 rounded-md border border-border-strong/70 bg-surface pl-8 pr-7 text-[13px] text-body placeholder:text-faint transition-colors hover:border-border-strong focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-faint transition-colors hover:text-secondary"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

export interface FilterOption {
  key: string;
  label: string;
  options: string[];
}

export function FilterButton({
  filters,
  applied,
  onApply,
}: {
  filters: FilterOption[];
  applied: Record<string, string>;
  onApply: (next: Record<string, string>) => void;
}) {
  const appliedCount = Object.values(applied).filter(Boolean).length;
  return (
    <>
      <Dropdown
        trigger={(open) => (
          <Button
            variant="secondary"
            size="md"
            className={cn(open && "border-primary text-primary")}
          >
            <ListFilter className="h-3.5 w-3.5" aria-hidden />
            Filter
            {appliedCount > 0 ? (
              <span className="rounded-full bg-primary px-1.5 text-[10px] font-bold text-white">
                {appliedCount}
              </span>
            ) : null}
          </Button>
        )}
        panelClassName="w-64 p-3"
      >
        {(close) => (
          <div className="flex flex-col gap-2.5">
            {filters.map((filter) => (
              <label key={filter.key} className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-secondary">
                  {filter.label}
                </span>
                <select
                  value={applied[filter.key] ?? ""}
                  onChange={(e) =>
                    onApply({ ...applied, [filter.key]: e.target.value })
                  }
                  className="h-8 rounded-md border border-border-strong/70 bg-surface px-2 text-[13px] text-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
                >
                  <option value="">All</option>
                  {filter.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <div className="mt-1 flex justify-between">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onApply({});
                  close();
                }}
              >
                Clear all
              </Button>
              <Button variant="primary" size="sm" onClick={close}>
                Done
              </Button>
            </div>
          </div>
        )}
      </Dropdown>
      {Object.entries(applied)
        .filter(([, v]) => v)
        .map(([key, value]) => {
          const label = filters.find((f) => f.key === key)?.label ?? key;
          return (
            <span
              key={key}
              className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary-soft px-2.5 py-1 text-[11px] font-medium text-primary"
            >
              {label}: {value}
              <button
                type="button"
                aria-label={`Remove ${label} filter`}
                onClick={() => onApply({ ...applied, [key]: "" })}
                className="transition-opacity hover:opacity-70"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </span>
          );
        })}
    </>
  );
}
