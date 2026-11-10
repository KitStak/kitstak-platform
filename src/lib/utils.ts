import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function formatMoney(value: number): string {
  return USD.format(value);
}

const NUM = new Intl.NumberFormat("en-US");

export function formatNumber(value: number): string {
  return NUM.format(value);
}

export function formatDate(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * "MLT1 - Main Fulfillment": code + name joined with a plain hyphen, without repeating
 * the code when the name already starts with it as a whole token ("MLT1 - Main
 * Fulfillment" stays as is, but "NovaForge" does not repeat the code "NOVA").
 */
export function codeNameLabel(code: string | null | undefined, name: string): string {
  if (!code) return name;
  const pattern = new RegExp(`^${escapeRegExp(code.trim())}(?![\\p{L}\\p{N}])`, "iu");
  return pattern.test(name.trim()) ? name : `${code} - ${name}`;
}
