"use client";

/**
 * Permission matrix (Add/Edit Role): collapsible groups with "(granted/total)" counters, a
 * group "Grant all" switch, per-page columns whose header checkbox toggles every action of
 * the page, action checkboxes, search, and Expand all / Collapse all. Read-only for system roles.
 */
import * as React from "react";
import { ChevronDown, ChevronsDownUp, ChevronsUpDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { filterMatrix, PERMISSION_MATRIX, toggleWithViewRule, type MatrixGroup, type MatrixPage } from "@/lib/grid-defs/admin/roles";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

interface MatrixProps {
  readonly value: readonly string[];
  readonly onChange: (keys: string[]) => void;
  readonly readOnly?: boolean;
}

function Counter({ granted, total }: { readonly granted: number; readonly total: number }) {
  const tone = granted === 0 ? "text-faint" : granted === total ? "text-success" : "text-primary";
  return <span className={cn("text-xs font-semibold tabular-nums", tone)}>({granted}/{total})</span>;
}

function PageColumn({ page, granted, onToggle, readOnly }: { readonly page: MatrixPage; readonly granted: ReadonlySet<string>; readonly onToggle: (keys: readonly string[]) => void; readonly readOnly: boolean }) {
  const keys = page.actions.map((a) => a.key);
  const count = keys.filter((k) => granted.has(k)).length;
  const state = count === 0 ? false : count === keys.length ? true : "indeterminate";
  return (
    <div className="flex min-w-0 flex-col rounded-lg border border-border bg-surface">
      <div className={cn("flex items-center gap-2 border-b border-border px-3 py-2", count > 0 && "bg-primary-soft/40")}>
        <Checkbox checked={state} disabled={readOnly} onCheckedChange={() => onToggle(keys)} aria-label={`All ${page.label} permissions`} />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground" title={page.label}>{page.label}</span>
        <Counter granted={count} total={keys.length} />
      </div>
      <ul className="flex flex-col gap-1 px-3 py-2">
        {page.actions.map((a) => (
          <li key={a.key}>
            <Checkbox checked={granted.has(a.key)} disabled={readOnly} onCheckedChange={() => onToggle([a.key])} label={<span className="text-xs text-body">{a.label}</span>} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function GroupPanel({ group, granted, open, onOpen, onToggle, readOnly, totalKeys }: { readonly group: MatrixGroup; readonly granted: ReadonlySet<string>; readonly open: boolean; readonly onOpen: () => void; readonly onToggle: (keys: readonly string[]) => void; readonly readOnly: boolean; readonly totalKeys: readonly string[] }) {
  const count = totalKeys.filter((k) => granted.has(k)).length;
  const state = count === 0 ? false : count === totalKeys.length ? true : "indeterminate";
  const panelId = `perm-group-${group.key}`;
  return (
    <section className="rounded-xl border border-border bg-surface-sunken/40">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <Checkbox checked={state} disabled={readOnly} onCheckedChange={() => onToggle(totalKeys)} aria-label={`All ${group.label} permissions`} />
        <button type="button" onClick={onOpen} aria-expanded={open} aria-controls={panelId}
          className="flex flex-1 items-center gap-2 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
          <span className="text-base font-semibold text-foreground">{group.label}</span>
          <Counter granted={count} total={totalKeys.length} />
          <span className="ml-auto h-1.5 w-24 overflow-hidden rounded-full bg-neutral-soft" aria-hidden>
            <span className="block h-full rounded-full bg-primary transition-[width]" style={{ width: `${totalKeys.length ? (count / totalKeys.length) * 100 : 0}%` }} />
          </span>
          <ChevronDown className={cn("h-4 w-4 text-secondary transition-transform", open && "rotate-180")} aria-hidden />
        </button>
      </div>
      {open ? (
        <div id={panelId} className="flex flex-col gap-4 border-t border-border px-3 pb-3 pt-3">
          {group.sections.map((section) => {
            const keys = section.pages.flatMap((p) => p.actions.map((a) => a.key));
            const sc = keys.filter((k) => granted.has(k)).length;
            return (
              <div key={section.label} className="flex flex-col gap-2">
                <h4 className="flex items-center gap-2 text-2xs font-bold text-secondary">
                  {section.label} <Counter granted={sc} total={keys.length} />
                </h4>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {section.pages.map((p) => <PageColumn key={p.key} page={p} granted={granted} onToggle={onToggle} readOnly={readOnly} />)}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

export function PermissionMatrix({ value, onChange, readOnly = false }: MatrixProps) {
  const [search, setSearch] = React.useState("");
  const [open, setOpen] = React.useState<ReadonlySet<string>>(new Set([PERMISSION_MATRIX[0]?.key ?? ""]));
  const granted = React.useMemo(() => new Set(value), [value]);
  const groups = filterMatrix(PERMISSION_MATRIX, search);
  const searching = search.trim().length > 0;
  // Actions imply View: ticking an action ticks View, and unticking View clears the page.
  const toggle = (keys: readonly string[]) => {
    if (readOnly) return;
    const next = toggleWithViewRule(value, keys);
    onChange(next.keys);
    if (next.clearedPages.length) toast.info("Page actions cleared", `Without View, ${next.clearedPages.join(", ")} can't be opened, so its actions were removed too.`);
  };
  const total = PERMISSION_MATRIX.reduce((n, g) => n + g.keys.length, 0);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex min-w-[220px] flex-1 items-center">
          <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-faint" aria-hidden />
          <span className="sr-only">Search permissions</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search permissions, e.g. cancel"
            className="h-8 w-full rounded-md border border-border bg-surface pl-7 pr-2 text-sm placeholder:text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" />
        </label>
        <Button size="sm" variant="ghost" onClick={() => setOpen(new Set(PERMISSION_MATRIX.map((g) => g.key)))}><ChevronsUpDown className="h-3.5 w-3.5" aria-hidden />Expand all</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(new Set())}><ChevronsDownUp className="h-3.5 w-3.5" aria-hidden />Collapse all</Button>
        <span className="ml-auto text-xs text-secondary">Granted <span className="font-semibold tabular-nums text-foreground">{value.length}</span> of {total}</span>
      </div>
      {groups.length === 0 ? <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-faint">No permission matches &ldquo;{search}&rdquo;.</p> : null}
      {groups.map((g) => (
        <GroupPanel key={g.key} group={g} granted={granted} readOnly={readOnly}
          totalKeys={searching ? g.keys : (PERMISSION_MATRIX.find((x) => x.key === g.key)?.keys ?? g.keys)}
          open={searching || open.has(g.key)}
          onOpen={() => setOpen((prev) => { const next = new Set(prev); if (next.has(g.key)) next.delete(g.key); else next.add(g.key); return next; })}
          onToggle={toggle} />
      ))}
    </div>
  );
}
