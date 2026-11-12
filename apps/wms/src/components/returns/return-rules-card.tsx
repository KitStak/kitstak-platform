"use client";

/**
 * Return Station side card: the Return Process parameters the server enforces on every receive
 * (Data Setup › Return Process), plus where each disposition puts the stock. Read-only.
 */
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useApiQuery } from "@/lib/query-client";
import { RETURN_RULE_DEFS, type ReturnRules } from "@/lib/grid-defs/admin/return-rules";

export function dispositionTargets(stationCode: string | null, targetCode: string | null): readonly { readonly disposition: string; readonly where: string }[] {
  const station = stationCode ?? "the station";
  const target = targetCode ?? station;
  return [
    { disposition: "Restock", where: `Sellable stock in ${target}` },
    { disposition: "Damaged", where: `Damaged stock in ${target} (damage reason required)` },
    { disposition: "Quarantine", where: `Held at ${station}` },
    { disposition: "Dispose", where: `Received at ${station}, then written off` },
  ];
}

export function ReturnRulesCard({ stationCode, targetCode }: { readonly stationCode: string | null; readonly targetCode: string | null }) {
  const q = useApiQuery<ReturnRules>(["returns", "rules"], "/api/returns/rules", { staleTime: 60_000 });
  const rules = q.data?.data;
  return (
    <Card className="flex flex-col gap-2 p-4" data-testid="return-rules-card">
      <h2 className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="h-4 w-4 text-secondary" aria-hidden />Return rules in force</h2>
      {!rules ? <p className="text-xs text-secondary">{q.isError ? "Could not load the return rules." : "Loading…"}</p> : (
        <ul className="flex flex-col gap-1 text-xs">
          {RETURN_RULE_DEFS.map((d) => (
            <li key={d.key} className="flex items-start justify-between gap-2" title={d.description}>
              <span className="text-body">{d.label}</span>
              <span className={rules[d.key] ? "font-semibold text-success" : "text-secondary"}>{rules[d.key] ? "On" : "Off"}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-1 border-t border-border pt-2">
        <p className="mb-1 text-xs font-semibold text-body">Where stock goes</p>
        <ul className="flex flex-col gap-0.5 text-xs text-secondary">
          {dispositionTargets(stationCode, targetCode).map((t) => <li key={t.disposition}><span className="font-medium text-body">{t.disposition}:</span> {t.where}</li>)}
        </ul>
      </div>
      <Link href="/settings/data-setup/return-process" className="text-xs font-medium text-primary hover:underline">Return Process settings</Link>
    </Card>
  );
}
