"use client";

/**
 * "Assign to" for count jobs and recounts: warehouse staff who can count
 * (`GET /api/counts/assignees`), never client-portal or API users. Empty = job pool.
 * The list is short and cached, so it opens instantly; the menu is height-capped so it
 * never covers the dialog's Save / Cancel buttons.
 */
import { useApiQuery } from "@/lib/query-client";
import { COUNT_QUERY_TIMEOUT_MS } from "./counts-client";
import { Select } from "@/components/ui/select";

interface Assignee { readonly id: string; readonly name: string; readonly email: string }

export function CountAssigneeSelect({ id, warehouseId, value, onChange }: { readonly id: string; readonly warehouseId: string | null; readonly value: string | null; readonly onChange: (v: string | null) => void }) {
  const q = useApiQuery<Assignee[]>(["count-assignees", warehouseId ?? ""], warehouseId ? "/api/counts/assignees" : null, { query: { warehouseId: warehouseId ?? "" }, staleTime: 5 * 60_000, timeoutMs: COUNT_QUERY_TIMEOUT_MS });
  const list = q.data?.data ?? [];
  const options = list.map((u) => ({ value: u.id, label: u.name, textValue: u.name, description: u.email }));
  const placeholder = !warehouseId ? "Select plans from one warehouse" : q.isPending ? "Loading staff…" : q.error ? "Staff could not be loaded" : options.length ? "Leave in the job pool" : "No staff can count in this warehouse";
  return (
    <div className="flex flex-col gap-1">
      <Select id={id} aria-label="Assign to" value={value} onChange={onChange} options={options} clearable placeholder={placeholder}
        disabled={!warehouseId || q.isPending || options.length === 0} contentClassName="max-h-[200px]" />
      {q.error ? <p role="alert" className="text-xs text-danger">{q.error.message} <button type="button" className="font-semibold underline" onClick={() => void q.refetch()}>Retry</button></p> : null}
      <p className="text-2xs text-secondary">Only warehouse staff with count permissions are listed.</p>
    </div>
  );
}
