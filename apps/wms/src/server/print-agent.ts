/**
 * KitStak Direct Print agent: a single-file Node.js (18+) program a workstation runs next to
 * its printers. `GET /api/printers/agent` serves it as `kitstak-print-agent.mjs`.
 *
 * It listens on 127.0.0.1:9101 only and answers the browser:
 *   GET  /status → { ok, version, platform, printers[] }   (the header Printers popover polls this)
 *   POST /print  → { printer, format: "zpl" | "pdf", data (base64) | url }
 *     - ZPL to "host:port" or "host" goes over a raw TCP socket (port 9100 by default);
 *     - ZPL / PDF to an OS printer name goes through the OS spooler (lp on macOS/Linux,
 *       PowerShell Out-Printer / Start-Process -Verb PrintTo on Windows).
 * Requests are accepted only from the origins passed with --origin (default: the server
 * that served the download), so other web pages can't print through it.
 */
export const PRINT_AGENT_VERSION = '1.0.0';
export const PRINT_AGENT_PORT = 9101;
export const PRINT_AGENT_FILENAME = 'kitstak-print-agent.mjs';

export function printAgentSource(origin: string): string {
  return `#!/usr/bin/env node
// KitStak Direct Print agent v${PRINT_AGENT_VERSION}
// Run:  node ${PRINT_AGENT_FILENAME} [--origin ${origin}] [--port ${PRINT_AGENT_PORT}]
// Keep this window open (or install it as a service) while you print from KitStak.
import http from "node:http";
import net from "node:net";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";

const arg = (name, fallback) => { const i = process.argv.indexOf("--" + name); return i > 0 ? process.argv[i + 1] : fallback; };
const PORT = Number(arg("port", "${PRINT_AGENT_PORT}"));
const ORIGINS = String(arg("origin", ${JSON.stringify(origin)})).split(",").map((o) => o.trim().replace(/\\/$/, ""));
const VERSION = "${PRINT_AGENT_VERSION}";

function listPrinters() {
  return new Promise((resolve) => {
    if (process.platform === "win32") {
      execFile("powershell", ["-NoProfile", "-Command", "Get-Printer | Select-Object -ExpandProperty Name"], (e, out) => resolve(e ? [] : out.split(/\\r?\\n/).map((s) => s.trim()).filter(Boolean)));
    } else {
      execFile("lpstat", ["-a"], (e, out) => resolve(e ? [] : out.split("\\n").map((l) => l.split(" ")[0]).filter(Boolean)));
    }
  });
}

function rawSocket(target, bytes) {
  const [host, port] = target.split(":");
  return new Promise((resolve, reject) => {
    const s = net.connect({ host, port: Number(port || 9100) }, () => s.end(bytes));
    s.setTimeout(10000, () => { s.destroy(); reject(new Error("Printer did not answer on " + target)); });
    s.on("error", reject);
    s.on("close", () => resolve());
  });
}

function spool(printer, bytes, ext) {
  const file = path.join(os.tmpdir(), "kitstak-" + Date.now() + "." + ext);
  fs.writeFileSync(file, bytes);
  return new Promise((resolve, reject) => {
    const done = (e) => { setTimeout(() => fs.rm(file, () => {}), 60000); e ? reject(e) : resolve(); };
    if (process.platform === "win32") {
      const cmd = ext === "pdf"
        ? "Start-Process -FilePath '" + file + "' -Verb PrintTo -ArgumentList '\\"" + printer + "\\"' -WindowStyle Hidden"
        : "Get-Content -Raw -Encoding Byte '" + file + "' | Out-Printer -Name '" + printer + "'";
      execFile("powershell", ["-NoProfile", "-Command", cmd], (e) => done(e));
    } else {
      execFile("lp", ["-d", printer, ...(ext === "zpl" ? ["-o", "raw"] : []), file], (e) => done(e));
    }
  });
}

const looksLikeHost = (p) => /^[\\d.]+(:\\d+)?$/.test(p) || /^[a-z0-9.-]+:\\d+$/i.test(p);

const server = http.createServer(async (req, res) => {
  const origin = String(req.headers.origin || "").replace(/\\/$/, "");
  const allowed = !origin || ORIGINS.includes(origin);
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Private-Network": "true" };
  if (allowed && origin) headers["Access-Control-Allow-Origin"] = origin;
  const send = (code, body) => { res.writeHead(code, headers); res.end(JSON.stringify(body)); };
  if (!allowed) return send(403, { ok: false, error: "Origin not allowed: " + origin });
  if (req.method === "OPTIONS") return send(204, {});
  if (req.method === "GET" && req.url === "/status") return send(200, { ok: true, version: VERSION, platform: process.platform, printers: await listPrinters() });
  if (req.method === "POST" && req.url === "/print") {
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 30e6) req.destroy(); });
    req.on("end", async () => {
      try {
        const job = JSON.parse(raw || "{}");
        if (!job.printer) return send(400, { ok: false, error: "printer is required" });
        const format = job.format === "pdf" ? "pdf" : "zpl";
        let bytes = job.data ? Buffer.from(job.data, "base64") : null;
        if (!bytes && job.url) { const r = await fetch(job.url, { headers: job.cookie ? { cookie: job.cookie } : {} }); bytes = Buffer.from(await r.arrayBuffer()); }
        if (!bytes) return send(400, { ok: false, error: "data or url is required" });
        if (format === "zpl" && looksLikeHost(job.printer)) await rawSocket(job.printer, bytes);
        else await spool(job.printer, bytes, format);
        console.log(new Date().toISOString(), "printed", format, "to", job.printer, bytes.length, "bytes");
        send(200, { ok: true });
      } catch (e) { console.error(e); send(500, { ok: false, error: String(e && e.message || e) }); }
    });
    return;
  }
  send(404, { ok: false, error: "Not found" });
});
server.listen(PORT, "127.0.0.1", () => console.log("KitStak Direct Print agent " + VERSION + " listening on http://127.0.0.1:" + PORT + " for " + ORIGINS.join(", ")));
`;
}
