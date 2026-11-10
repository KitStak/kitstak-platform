/**
 * Products list URL aliases. PURE (client-safe). Logiwa shares list links as
 * `?sku=<text>&skuqt=eq&ps=100`; KitStaks' grid grammar uses `q` / `qm` / `ps`. Both work:
 * `search=` / `sku=` → `q`, `skuqt=eq|sw` → `qm`. Canonical params win when both are sent.
 */
export function aliasProductListParams(source: URLSearchParams): URLSearchParams {
  const params = new URLSearchParams(source);
  const text = params.get("search") ?? params.get("sku");
  if (!params.has("q") && text !== null) params.set("q", text);
  const mode = params.get("skuqt");
  if (!params.has("qm") && mode !== null) params.set("qm", mode === "eq" ? "eq" : "sw");
  for (const k of ["search", "sku", "skuqt"]) params.delete(k);
  return params;
}
