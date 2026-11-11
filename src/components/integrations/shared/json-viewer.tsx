"use client";

/** Pretty JSON block with Copy and Download (payloads, carrier request/response bodies). */
import * as React from "react";
import { Check, Copy, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

export function prettyJson(raw: string | unknown): string {
  if (typeof raw !== "string") return JSON.stringify(raw, null, 2);
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export function downloadText(filename: string, text: string, type = "application/json"): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Tokenised colouring without dangerouslySetInnerHTML. */
function Highlighted({ text }: { readonly text: string }) {
  const parts = text.split(/("(?:\\.|[^"\\])*"(?:\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (!p) return null;
        if (p.startsWith("\"")) return <span key={i} className={p.trimEnd().endsWith(":") ? "text-info" : "text-success"}>{p}</span>;
        if (/^(true|false|null)$/.test(p)) return <span key={i} className="text-warning">{p}</span>;
        if (/^-?\d/.test(p)) return <span key={i} className="text-primary">{p}</span>;
        return <React.Fragment key={i}>{p}</React.Fragment>;
      })}
    </>
  );
}

export function JsonViewer({ title, value, filename, maxHeight = "45vh" }: { readonly title: string; readonly value: string | unknown; readonly filename: string; readonly maxHeight?: string }) {
  const text = React.useMemo(() => prettyJson(value), [value]);
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy", "Your browser blocked clipboard access.");
    }
  };
  return (
    <section className="flex flex-col overflow-hidden rounded-lg border border-border">
      <header className="flex items-center gap-2 border-b border-border bg-surface-sunken/70 px-3 py-2">
        <h4 className="flex-1 text-xs font-semibold text-secondary">{title}</h4>
        <Button size="sm" variant="ghost" onClick={() => void copy()} aria-label={`Copy ${title}`}>{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copied ? "Copied" : "Copy"}</Button>
        <Button size="sm" variant="secondary" onClick={() => downloadText(filename, text)}><Download className="h-3.5 w-3.5" />Download</Button>
      </header>
      <pre tabIndex={0} aria-label={title} className="overflow-auto bg-surface px-3 py-2 font-mono text-xs leading-5 text-body" style={{ maxHeight }}>
        <Highlighted text={text} />
      </pre>
    </section>
  );
}
