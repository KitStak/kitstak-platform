"use client";

/** POSTs JSON and returns the PDF as an object URL (designer preview, template preview). */
import { getCsrfToken } from "@/lib/api-client";
import { CSRF_HEADER } from "@/server/auth/csrf-shared";

export class PdfError extends Error {}

async function readError(res: Response): Promise<string> {
  try {
    const json = (await res.json()) as { error?: { message?: string } };
    return json.error?.message ?? `Preview failed (${res.status})`;
  } catch {
    return `Preview failed (${res.status})`;
  }
}

export async function fetchPdfUrl(path: string, body: unknown, signal?: AbortSignal): Promise<string> {
  const send = async (token: string) => fetch(path, {
    method: "POST", credentials: "same-origin", cache: "no-store", signal,
    headers: { "content-type": "application/json", [CSRF_HEADER]: token },
    body: JSON.stringify(body),
  });
  let res = await send(await getCsrfToken());
  if (res.status === 403) res = await send(await getCsrfToken(true));
  if (!res.ok) throw new PdfError(await readError(res));
  const blob = await res.blob();
  return URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
}

/** Opens a rendered PDF in a new tab (falls back to same-tab download when popups are blocked). */
export async function openPdf(path: string, body: unknown): Promise<void> {
  const url = await fetchPdfUrl(path, body);
  const win = window.open(url, "_blank", "noopener");
  if (!win) {
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener";
    a.click();
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
