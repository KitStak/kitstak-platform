'use client';

/** POSTs JSON and returns the PDF as an object URL (designer preview, template preview). */
export class PdfError extends Error {}

async function readError(res: Response): Promise<string> {
  try {
    const json = (await res.json()) as { error?: { message?: string } };
    return json.error?.message ?? `Preview failed (${res.status})`;
  } catch {
    return `Preview failed (${res.status})`;
  }
}

async function postJson(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new PdfError(await readError(res));
  return res;
}

export async function fetchPdfUrl(path: string, body: unknown, signal?: AbortSignal): Promise<string> {
  const res = await postJson(path, body, signal);
  const blob = await res.blob();
  return URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
}

/** POSTs JSON and returns the response body as text (ZPL preview). */
export async function fetchText(path: string, body: unknown, signal?: AbortSignal): Promise<string> {
  return (await postJson(path, body, signal)).text();
}

/** Opens a rendered PDF in a new tab (falls back to same-tab download when popups are blocked). */
export async function openPdf(path: string, body: unknown): Promise<void> {
  const url = await fetchPdfUrl(path, body);
  const win = window.open(url, '_blank', 'noopener');
  if (!win) {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.click();
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
