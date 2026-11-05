"use client";

import * as React from "react";
import { Clock, Layers, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface WaveRule {
  id: string;
  name: string;
  trigger: string;
  jobType: string;
  schedule: string;
  lastRun: string;
  wavesLast7Days: number;
  enabledByDefault: boolean;
}

/** Hand-seeded, deterministic wave rules (no rules API yet). */
const WAVE_RULES: readonly WaveRule[] = [
  {
    id: "wr-01",
    name: "Priority Shipping",
    trigger: "Orders with High or Urgent priority, any channel, group by carrier",
    jobType: "Single Unit Orders",
    schedule: "Every 15 min",
    lastRun: "Today, 1:45 PM",
    wavesLast7Days: 86,
    enabledByDefault: true,
  },
  {
    id: "wr-02",
    name: "Same-Day Cutoff",
    trigger: "Expedited services ordered before 2:00 PM, release as one wave per client",
    jobType: "Multi Item Orders",
    schedule: "Daily at 2:00 PM",
    lastRun: "Today, 2:00 PM",
    wavesLast7Days: 7,
    enabledByDefault: true,
  },
  {
    id: "wr-03",
    name: "Single Unit Express",
    trigger: "Single-line, single-qty orders batched up to 40 per wave",
    jobType: "Single Unit Orders",
    schedule: "Every 30 min",
    lastRun: "Today, 1:30 PM",
    wavesLast7Days: 112,
    enabledByDefault: true,
  },
  {
    id: "wr-04",
    name: "Multi Item Zone Pick",
    trigger: "Multi-line orders grouped by pick zone, max 12 orders per job",
    jobType: "Multi Item Orders",
    schedule: "Hourly",
    lastRun: "Today, 1:00 PM",
    wavesLast7Days: 54,
    enabledByDefault: true,
  },
  {
    id: "wr-05",
    name: "Replenishment Trigger",
    trigger: "Forward-pick bins below 25% capacity create replenishment jobs",
    jobType: "Dynamic Replenishment",
    schedule: "Every 2 hours",
    lastRun: "Oct 31, 9:12 AM",
    wavesLast7Days: 0,
    enabledByDefault: false,
  },
];

export const WAVE_RULE_COUNT = WAVE_RULES.length;

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full transition-colors duration-150",
        "outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        checked ? "bg-primary" : "bg-border-strong"
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-xs transition-[left] duration-150",
          checked ? "left-[18px]" : "left-0.5"
        )}
        aria-hidden
      />
    </button>
  );
}

export function WaveRulesTab() {
  const [enabled, setEnabled] = React.useState<Record<string, boolean>>(() =>
    Object.fromEntries(WAVE_RULES.map((r) => [r.id, r.enabledByDefault]))
  );

  const activeCount = Object.values(enabled).filter(Boolean).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto px-6 pb-6 pt-4 ks-scroll">
      <div className="mx-auto w-full max-w-4xl">
        <div className="mb-3 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-[15px] font-semibold text-foreground">Wave rules</h2>
            <p className="mt-0.5 text-[12px] text-faint">
              Rules run on a schedule and release matching orders into picking jobs.{" "}
              <span className="font-medium text-secondary">
                {activeCount} of {WAVE_RULES.length} active
              </span>
            </p>
          </div>
          <Button variant="secondary" size="md">
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Create Wave Rule
          </Button>
        </div>

        <Card>
          <ul className="divide-y divide-border">
            {WAVE_RULES.map((rule) => {
              const isOn = enabled[rule.id] ?? false;
              return (
                <li key={rule.id} className="flex items-center gap-4 px-5 py-3.5">
                  <Toggle
                    checked={isOn}
                    onChange={(next) =>
                      setEnabled((prev) => ({ ...prev, [rule.id]: next }))
                    }
                    label={`Enable ${rule.name}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p
                        className={cn(
                          "truncate text-[13px] font-semibold",
                          isOn ? "text-foreground" : "text-secondary"
                        )}
                      >
                        {rule.name}
                      </p>
                      <span className="inline-flex items-center gap-1 rounded-full bg-neutral-soft px-2 py-0.5 text-[10px] font-semibold text-neutral">
                        <Layers className="h-2.5 w-2.5" aria-hidden />
                        {rule.jobType}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-[12px] text-faint">
                      {rule.trigger}
                    </p>
                  </div>
                  <div className="hidden flex-col items-end gap-1 sm:flex">
                    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-sunken px-2 py-0.5 text-[11px] font-medium text-secondary">
                      <Clock className="h-3 w-3" aria-hidden />
                      {rule.schedule}
                    </span>
                    <span className="text-[11px] tabular-nums text-faint">
                      Last run {rule.lastRun} · {rule.wavesLast7Days} waves / 7d
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>

        <p className="mt-3 text-[11px] text-faint">
          Disabled rules keep their configuration but stop releasing waves. Orders they
          would have matched stay in the backlog until picked up by another rule.
        </p>
      </div>
    </div>
  );
}
