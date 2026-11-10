"use client";

/**
 * WYSIWYG canvas for the printout designer: draws the layout in the browser at true paper
 * proportions (points → px), mirroring the PDF renderer's flow (sections, line table, blocks).
 * Clicking a block on the canvas selects it for editing; built-in sections highlight on hover.
 * The PDF tab remains the source of truth for page breaks and exact typography.
 */
import * as React from "react";
import { renderBarcodeSvg, type BarcodeType } from "@/components/ui/barcode";
import { cn } from "@/lib/utils";
import {
  blockIdOf, columnsFor, DOCUMENT_COLUMNS, isTwoDimensional, printDate, printFieldValue,
  type BarcodeSymbology, type PrintBlock, type PrintoutLayout, type PrintRecord,
} from "@/lib/grid-defs/admin/printouts";

/** Same table as the server renderer (points). */
const PAPER_POINTS: Readonly<Record<PrintoutLayout["paper"], readonly [number, number]>> = {
  Letter: [612, 792], A4: [595.28, 841.89], Legal: [612, 1008],
  "4x6": [288, 432], "4x4": [288, 288], "4x3": [288, 216], "4x2": [288, 144], "3x2": [216, 144], "2x1": [144, 72],
};
const FONT_STACK: Readonly<Record<PrintoutLayout["font"], string>> = {
  Helvetica: "Helvetica, Arial, sans-serif", Times: "'Times New Roman', Times, serif", Courier: "'Courier New', Courier, monospace",
};
const MUTED = "#667085";

function BarcodeImg({ value, symbology, widthPt, heightPt, z, align }: { readonly value: string; readonly symbology: BarcodeSymbology; readonly widthPt: number; readonly heightPt: number; readonly z: number; readonly align: "left" | "center" | "right" }) {
  const result = React.useMemo(() => renderBarcodeSvg({ value, type: symbology as BarcodeType, height: 10, scale: 2, showText: false }), [value, symbology]);
  const justify = align === "right" ? "flex-end" : align === "center" ? "center" : "flex-start";
  if (!result.svg) {
    return <div style={{ display: "flex", justifyContent: justify }}><span style={{ fontSize: 8 * z, color: "#B42318" }}>{value ? `Can't encode "${value}" as ${symbology}` : "Barcode field is empty"}</span></div>;
  }
  const twoD = isTwoDimensional(symbology);
  const style: React.CSSProperties = twoD ? { height: heightPt * z, width: "auto", maxWidth: widthPt * z } : { width: widthPt * z, height: heightPt * z };
  return (
    <div style={{ display: "flex", justifyContent: justify }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- generated SVG data URI */}
      <img alt={`${symbology} barcode ${value}`} src={`data:image/svg+xml;utf8,${encodeURIComponent(result.svg)}`} style={{ ...style, objectFit: twoD ? "contain" : "fill", imageRendering: "pixelated" }} />
    </div>
  );
}

interface Props {
  readonly layout: PrintoutLayout;
  readonly typeKey: string;
  readonly record: PrintRecord | null;
  readonly companyName: string;
  readonly logoUrl: string | null;
  readonly selected: string | null;
  readonly onSelect: (blockId: string | null) => void;
}

export function CanvasPreview({ layout, typeKey, record, companyName, logoUrl, selected, onSelect }: Props) {
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const [avail, setAvail] = React.useState(640);
  React.useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setAvail(Math.max(200, (entry?.contentRect.width ?? 640) - 32)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [pw, ph] = PAPER_POINTS[layout.paper];
  const isLabel = layout.family === "label";
  const z = Math.min(avail / pw, isLabel ? 2.2 : 1.25);
  const margin = isLabel ? (ph <= 72 ? 5 : ph <= 144 ? 8 : 12) : 40;
  const tiny = isLabel && ph <= 72;
  const small = isLabel && ph <= 144;
  const [logoBroken, setLogoBroken] = React.useState(false);
  const accent = layout.accentColor;
  const fs = layout.fontSize;
  const rec: PrintRecord = record ?? { code: "SO010412", lines: [] };
  const opts = { companyName };
  const cols = (() => {
    const known = columnsFor(typeKey);
    return layout.columns.filter((c) => c.enabled).map((c) => known.find((k) => k.key === c.key) ?? DOCUMENT_COLUMNS.find((k) => k.key === c.key)).filter((v): v is NonNullable<typeof v> => Boolean(v));
  })();
  const totalW = cols.reduce((n, c) => n + c.width, 0) || 1;
  const px = (pt: number) => pt * z;
  const alignText = (a: "left" | "center" | "right") => a;

  const logoNode = (h: number, pos: "left" | "center" | "right") => (
    <div style={{ display: "flex", justifyContent: pos === "right" ? "flex-end" : pos === "center" ? "center" : "flex-start", height: px(h), alignItems: "center" }}>
      {logoUrl && !logoBroken
        // eslint-disable-next-line @next/next/no-img-element -- same-origin company logo
        ? <img src={logoUrl} alt="Company logo" onError={() => setLogoBroken(true)} style={{ height: px(h), width: "auto", maxWidth: px(160) }} />
        : <span style={{ fontSize: px(16), fontWeight: 700, color: accent }}>{companyName}</span>}
    </div>
  );

  const blockNode = (b: PrintBlock) => {
    const color = b.color;
    switch (b.kind) {
      case "spacer": return <div style={{ height: px(b.height) }} />;
      case "divider": return <div style={{ padding: `${px(3)}px 0` }}><div style={{ borderTop: `${Math.max(1, px(Math.min(b.height, 6)))}px solid ${color}` }} /></div>;
      case "text":
      case "field": {
        const value = b.kind === "text" ? b.text : `${b.text}${printFieldValue(rec, b.field, opts)}`;
        return <div style={{ fontSize: px(b.size), lineHeight: 1.25, fontWeight: b.bold ? 700 : 400, color, textAlign: alignText(b.align), whiteSpace: "pre-wrap", wordBreak: "break-word", paddingBottom: px(3) }}>{value || (b.kind === "field" ? <span style={{ color: MUTED, fontStyle: "italic" }}>(empty)</span> : " ")}</div>;
      }
      case "barcode": return <div style={{ paddingBottom: px(6) }}><BarcodeImg value={printFieldValue(rec, b.field, opts)} symbology={b.symbology} widthPt={((pw - margin * 2) * b.widthPct) / 100} heightPt={isTwoDimensional(b.symbology) ? Math.min(b.height * 3, ((pw - margin * 2) * b.widthPct) / 100) : b.height} z={z} align={b.align} /></div>;
      case "image": {
        const src = b.imageDataUrl || (logoBroken ? null : logoUrl);
        const justify = b.align === "right" ? "flex-end" : b.align === "center" ? "center" : "flex-start";
        return (
          <div style={{ display: "flex", justifyContent: justify, paddingBottom: px(6) }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- inline data URL or same-origin logo */}
            {src ? <img src={src} alt="" style={{ maxHeight: px(b.height), maxWidth: px(((pw - margin * 2) * b.widthPct) / 100), width: "auto", height: "auto" }} /> : <span style={{ fontSize: px(8), color: MUTED }}>{companyName} (no logo uploaded)</span>}
          </div>
        );
      }
    }
  };

  const sectionNode = (key: string): React.ReactNode => {
    if (isLabel) {
      switch (key) {
        case "logo": return layout.logoPosition === "hidden" ? null : <div style={{ paddingBottom: px(4) }}>{logoNode(tiny ? 10 : small ? 14 : 24, layout.logoPosition as "left" | "center" | "right")}</div>;
        case "title": return <div style={{ fontSize: px(tiny ? 6 : small ? 9 : fs + 4), fontWeight: 700, color: accent, paddingBottom: px(tiny ? 2 : 6) }}>{layout.title}</div>;
        case "barcode": {
          const twoD = isTwoDimensional(layout.barcodeType);
          const maxH = tiny ? 26 : small ? 50 : 120;
          return <div style={{ paddingBottom: px(tiny ? 2 : 4) }}><BarcodeImg value={rec.code} symbology={layout.barcodeType} widthPt={pw - margin * 2} heightPt={twoD ? Math.min(maxH * (small ? 1 : 1.2), pw - margin * 2) : maxH * 0.75} z={z} align="center" /></div>;
        }
        case "code": return <div style={{ fontSize: px(tiny ? 8 : small ? 12 : 20), fontWeight: 700, textAlign: "center", paddingBottom: px(tiny ? 2 : 6) }}>{rec.code}</div>;
        case "details": return <div>{(rec.details ?? []).slice(0, tiny ? 0 : small ? 1 : 5).map((d) => <div key={d} style={{ fontSize: px(fs), paddingBottom: px(3) }}>{d}</div>)}</div>;
        case "footer": return small ? null : <div style={{ position: "absolute", left: px(margin), bottom: px(margin - 4), fontSize: px(7), color: MUTED }}>Printed {printDate(undefined)} · {companyName}</div>;
        default: return null;
      }
    }
    switch (key) {
      case "logo": return layout.logoPosition === "hidden" ? null : <div style={{ paddingBottom: px(10) }}>{logoNode(36, layout.logoPosition as "left" | "center" | "right")}</div>;
      case "header": {
        const pairs: [string, string][] = [["Code", rec.code], ["Reference", rec.reference ?? "-"], ["Date", printDate(rec.date)], ["Client", rec.clientName ?? "-"], ["Carrier", rec.carrier ?? "-"]];
        return (
          <div style={{ paddingBottom: px(10) }}>
            <div style={{ fontSize: px(fs + 8), fontWeight: 700, color: accent, paddingBottom: px(8) }}>{layout.title || "Printout"}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", rowGap: px(8) }}>
              {pairs.map(([k, v]) => <div key={k}><div style={{ fontSize: px(7), fontWeight: 700, color: MUTED, letterSpacing: "0.04em" }}>{k.toUpperCase()}</div><div style={{ fontSize: px(fs) }}>{v}</div></div>)}
            </div>
          </div>
        );
      }
      case "barcode": {
        const twoD = isTwoDimensional(layout.barcodeType);
        return <div style={{ paddingBottom: px(10) }}><BarcodeImg value={rec.code} symbology={layout.barcodeType} widthPt={twoD ? 72 : 200} heightPt={twoD ? 72 : 34} z={z} align={layout.logoPosition === "right" ? "left" : "right"} /></div>;
      }
      case "addresses": return (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", borderBottom: `${Math.max(1, px(0.6))}px solid #D0D5DD`, paddingBottom: px(8), marginBottom: px(8) }}>
          {([["SHIP TO", rec.shipTo], ["SHIP FROM", rec.shipFrom]] as const).map(([label, lines]) => (
            <div key={label}>{lines?.length ? <><div style={{ fontSize: px(7), fontWeight: 700, color: MUTED }}>{label}</div>{lines.map((l, i) => <div key={i} style={{ fontSize: px(fs) }}>{l}</div>)}</> : null}</div>
          ))}
        </div>
      );
      case "lines": return cols.length ? (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: px(fs), marginBottom: px(8), tableLayout: "fixed" }}>
          <thead><tr style={{ background: "#F0F2F7" }}>{cols.map((c) => <th key={c.key} style={{ width: `${(c.width / totalW) * 100}%`, textAlign: c.align ?? "left", fontSize: px(fs - 2), color: MUTED, fontWeight: 700, padding: `${px(3)}px ${px(4)}px` }}>{c.label.toUpperCase()}</th>)}</tr></thead>
          <tbody>
            {rec.lines.map((l, i) => {
              const v: Record<string, string> = { location: l.location ?? "", sku: l.sku, description: l.description, lot: l.lot ?? "", uom: l.uom ?? "Each", qty: String(l.qty), price: l.price === undefined ? "" : l.price.toFixed(2), total: l.price === undefined ? "" : (l.price * l.qty).toFixed(2) };
              return <tr key={i} style={{ borderBottom: "1px solid #D0D5DD" }}>{cols.map((c) => <td key={c.key} style={{ textAlign: c.align ?? "left", padding: `${px(3)}px ${px(4)}px`, verticalAlign: "top", wordBreak: "break-word" }}>{v[c.key]}</td>)}</tr>;
            })}
          </tbody>
        </table>
      ) : null;
      case "totals": {
        const units = rec.lines.reduce((n, l) => n + l.qty, 0);
        const amount = rec.lines.reduce((n, l) => n + (l.price ?? 0) * l.qty, 0);
        const showAmount = cols.some((c) => c.key === "price" || c.key === "total");
        return <div style={{ textAlign: "right", fontWeight: 700, fontSize: px(fs + 1), paddingBottom: px(10) }}>Total units: {units}{showAmount ? `    Total: ${amount.toFixed(2)}` : ""}</div>;
      }
      case "notes": return rec.notes ? <div style={{ paddingBottom: px(8) }}><div style={{ fontSize: px(7), fontWeight: 700, color: MUTED }}>NOTES</div><div style={{ fontSize: px(fs) }}>{rec.notes}</div></div> : null;
      case "footer": return <div style={{ position: "absolute", left: px(margin), bottom: px(margin / 2 - 4), fontSize: px(7), color: MUTED }}>{layout.footerText}{layout.footerText ? "  ·  " : ""}Page 1 of 1</div>;
      default: return null;
    }
  };

  return (
    <div ref={wrapRef} className="flex flex-1 items-start justify-center overflow-auto rounded-md bg-[repeating-conic-gradient(#e7e9ee_0%_25%,#f1f2f5_0%_50%)] bg-[length:16px_16px] p-4">
      <div
        role="document"
        aria-label={`${layout.title || "Printout"} canvas preview`}
        onClick={() => onSelect(null)}
        className="relative shrink-0 bg-white text-[#1A1F29] shadow-[0_1px_3px_rgba(16,24,40,0.12),0_8px_24px_rgba(16,24,40,0.10)]"
        style={{ width: px(pw), minHeight: px(ph), height: isLabel ? px(ph) : undefined, overflow: isLabel ? "hidden" : "visible", padding: px(margin), fontFamily: FONT_STACK[layout.font], borderRadius: isLabel ? px(6) : 0 }}
      >
        {layout.sections.filter((s) => s.enabled).map((s) => {
          const id = blockIdOf(s.key);
          if (id === null) {
            const node = sectionNode(s.key);
            return node ? <div key={s.key} data-section={s.key} className="rounded-sm outline-1 outline-offset-2 outline-transparent hover:outline-dashed hover:outline-border-strong">{node}</div> : null;
          }
          const b = layout.blocks.find((x) => x.id === id);
          if (!b) return null;
          const isSel = selected === b.id;
          return (
            <div key={s.key} role="button" tabIndex={0} aria-pressed={isSel} aria-label={`Edit ${b.kind} block`}
              onClick={(e) => { e.stopPropagation(); onSelect(isSel ? null : b.id); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(isSel ? null : b.id); } }}
              className={cn("cursor-pointer rounded-sm outline-offset-2 focus-visible:outline-2 focus-visible:outline-primary", isSel ? "outline-2 outline-primary [outline-style:solid]" : "outline-1 outline-transparent hover:outline-dashed hover:outline-primary/60")}>
              {blockNode(b)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
