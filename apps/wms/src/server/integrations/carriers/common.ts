/**
 * Shared machinery for the M12 carrier adapters (UPS, FedEx, EasyPost, Shippo).
 * - Test environment (or no credentials): an offline simulation that applies the carrier's own
 *   request validation (e.g. UPS ship-from phone ≥ 10 characters) and sandbox-style rates, so
 *   errors land in Carrier Errors with the same HTTP codes the live API returns.
 * - Production with credentials: the provider's `live` implementation (real HTTP).
 */
import { createHash } from "node:crypto";
import { verifyAddress } from "@/server/domain/address-verification";
import {
  CarrierError, type CarrierAdapter, type CarrierAddress, type LabelRequest, type LabelResult, type PackageSpec, type RateQuote, type RateRequest, type VoidRequest,
} from "@/server/domain/carriers/adapter";
import { renderPdfLabel, renderZplLabel } from "@/server/domain/carriers/label";
import { decryptCredentials, type Credentials } from "../crypto";
import { mapSeq } from "@/server/db/sql";

export interface ServiceDef {
  readonly code: string;
  readonly name: string;
  readonly transitDays: number;
  readonly base: number;
  readonly perLb: number;
  readonly international?: boolean;
}

export interface PackageDef { readonly code: string; readonly name: string }

export interface LiveCarrier {
  rate(req: RateRequest, creds: Credentials): Promise<readonly RateQuote[]>;
  createLabel(req: LabelRequest, creds: Credentials): Promise<LabelResult>;
  voidLabel(req: VoidRequest, creds: Credentials): Promise<{ voided: boolean; message?: string }>;
  /** Credential check for Add New Connection → Continue. */
  validate(creds: Credentials, environment: "Test" | "Production"): Promise<string>;
}

export interface CarrierDef {
  readonly provider: string;
  readonly carrierCode: string;
  readonly services: readonly ServiceDef[];
  readonly packages: readonly PackageDef[];
  readonly trackingPrefix: string;
  readonly trackingLength: number;
  /** Carrier-specific request validation (throws CarrierError 400). */
  validateRequest(from: CarrierAddress, to: CarrierAddress, packages: readonly PackageSpec[]): void;
  readonly live: LiveCarrier;
  /** Which credential fields the Add New Connection drawer asks for. */
  readonly credentialFields: readonly { readonly key: string; readonly label: string; readonly secret: boolean }[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
export const isInternational = (country: string) => !["united states", "us", "usa"].includes(country.trim().toLowerCase());

export function zoneOf(fromZip: string, toZip: string, intl: boolean): number {
  if (intl) return 9;
  const a = Number.parseInt(fromZip.slice(0, 3), 10);
  const b = Number.parseInt(toZip.slice(0, 3), 10);
  if (Number.isNaN(a) || Number.isNaN(b)) return 8;
  return Math.min(8, 2 + Math.floor(Math.abs(a - b) / 150));
}

export function rateOf(s: ServiceDef, zone: number, pkg: PackageSpec): number {
  const dim = (pkg.length * pkg.width * pkg.height) / 139;
  const lb = Math.max(1, Math.ceil(Math.max(pkg.weightOz / 16, dim)));
  return round2((s.base + s.perLb * lb) * (1 + (zone - 2) * 0.085));
}

function deliveryDate(shipDate: string, transitDays: number): string {
  const d = new Date(`${shipDate.slice(0, 10)}T17:00:00.000Z`);
  let added = 0;
  while (added < transitDays) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) added++; }
  return d.toISOString();
}

export function assertPackages(packages: readonly PackageSpec[]): void {
  if (packages.length === 0) throw new CarrierError("At least one package is required.", 400);
  for (const p of packages) {
    if (!(p.weightOz > 0)) throw new CarrierError("Package weight must be greater than 0.", 400);
    if (!(p.length > 0 && p.width > 0 && p.height > 0)) throw new CarrierError("Package dimensions must be greater than 0.", 400);
  }
}

export const phoneDigits = (p: string | null | undefined) => (p ?? "").replace(/[^0-9A-Za-z]/g, "");

function tracking(def: CarrierDef, seed: string): string {
  const hex = createHash("sha1").update(seed).digest("hex");
  let digits = "";
  for (let i = 0; digits.length < def.trackingLength; i++) digits += String(Number.parseInt(hex[i % hex.length] as string, 16) % 10);
  return `${def.trackingPrefix}${digits}`;
}

/**
 * Credentials for a real carrier call, or null for the offline simulation.
 * - Production: the carrier's live API.
 * - Test with stored credentials: the carrier's own test API (UPS CIE, FedEx sandbox, EasyPost / Shippo test
 *   keys, Stamps testing), so a carrier-certified test account creates and voids labels end to end.
 *   KITSTAK_CARRIER_SIMULATE=1 forces the simulation (CI / offline dev).
 * - Test without credentials: the simulation.
 */
function liveCreds(connection: RateRequest["connection"]): Credentials | null {
  if (connection.environment !== "Production" && process.env.KITSTAK_CARRIER_SIMULATE === "1") return null;
  return decryptCredentials(connection.credentialsEnc);
}

/** How a connection's calls are served: "live", "carrier-test" (the carrier's sandbox API) or "simulated". */
export function carrierCallMode(connection: Pick<RateRequest["connection"], "environment" | "credentialsEnc">): "live" | "carrier-test" | "simulated" {
  if (!liveCreds(connection as RateRequest["connection"])) return "simulated";
  return connection.environment === "Production" ? "live" : "carrier-test";
}

/** Builds the registered adapter for a provider. */
export function buildCarrierAdapter(def: CarrierDef): CarrierAdapter {
  const service = (code: string) => {
    const s = def.services.find((x) => x.code === code);
    if (!s) throw new CarrierError(`Service ${code} is not offered by ${def.carrierCode}.`, 400);
    return s;
  };
  return {
    provider: def.provider,
    async rate(req) {
      const creds = liveCreds(req.connection);
      if (creds) return def.live.rate(req, creds);
      assertPackages(req.packages);
      def.validateRequest(req.from, req.to, req.packages);
      const intl = isInternational(req.to.country);
      const zone = zoneOf(req.from.postalCode, req.to.postalCode, intl);
      const today = new Date().toISOString().slice(0, 10);
      return req.services.flatMap((svc) => {
        const s = def.services.find((x) => x.code === svc.serviceCode);
        if (!s || Boolean(s.international) !== intl) return [];
        return [{
          carrierServiceId: svc.id, serviceCode: s.code, serviceName: svc.name, carrierCode: def.carrierCode, currency: "USD", transitDays: s.transitDays, zone: String(zone),
          amount: round2(req.packages.reduce((sum, p) => sum + rateOf(s, zone, p), 0)), estimatedDeliveryAt: deliveryDate(today, s.transitDays),
        }];
      });
    },
    async createLabel(req) {
      const creds = liveCreds(req.connection);
      if (creds) return def.live.createLabel(req, creds);
      assertPackages(req.packages);
      def.validateRequest(req.from, req.to, req.packages);
      const check = verifyAddress(req.to);
      if (check.status === "Failed") throw new CarrierError(`Address validation failed: ${check.notes.join(" ")}`, 422);
      const s = service(req.service.serviceCode);
      const intl = isInternational(req.to.country);
      if (intl !== Boolean(s.international)) throw new CarrierError(`${req.service.name} is ${s.international ? "international only" : "domestic only"}.`, 400);
      const zone = zoneOf(req.from.postalCode, req.to.postalCode, intl);
      const packages = await Promise.all(await mapSeq(req.packages, async (pkg, i) => {
        const trackingNumber = tracking(def, `${def.provider}|${req.orderCode}|${req.labelType}|${req.attempt}|${i + 1}`);
        const data = { from: req.from, to: req.to, carrierCode: def.carrierCode, serviceName: req.service.name, trackingNumber, orderCode: req.orderCode, weightOz: pkg.weightOz, packageSeq: i + 1, packageCount: req.packages.length, shipDate: req.shipDate.slice(0, 10), labelType: req.labelType };
        const label = req.format === "PDF" ? await renderPdfLabel(data) : new TextEncoder().encode(renderZplLabel(data));
        return { trackingNumber, amount: rateOf(s, zone, pkg), label };
      }));
      return {
        masterTrackingNumber: packages[0]?.trackingNumber ?? "", packages, totalAmount: round2(packages.reduce((sum, p) => sum + p.amount, 0)), currency: "USD",
        zone: String(zone), estimatedDeliveryAt: deliveryDate(req.shipDate, s.transitDays), format: req.format === "PDF" ? "PDF" : "ZPL",
      };
    },
    async voidLabel(req) {
      const creds = liveCreds(req.connection);
      if (creds) return def.live.voidLabel(req, creds);
      if (!req.trackingNumber.startsWith(def.trackingPrefix)) throw new CarrierError(`Unknown ${def.carrierCode} tracking number ${req.trackingNumber}.`, 404);
      return { voided: true };
    },
    async validateAddress(address) {
      return verifyAddress(address);
    },
  };
}

/** Minimal fetch helper for live carrier APIs; non-2xx become CarrierError with the HTTP code. */
export async function carrierFetch(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    let body: unknown = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
    if (!res.ok) {
      const msg = JSON.stringify(body).slice(0, 400);
      throw new CarrierError(`${res.status} ${res.statusText}: ${msg}`, res.status);
    }
    return (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof CarrierError) throw error;
    throw new CarrierError(error instanceof Error && error.name === "AbortError" ? "The carrier did not respond within 25 seconds" : `Couldn't reach the carrier: ${error instanceof Error ? error.message : "network error"}`, 504);
  } finally {
    clearTimeout(timer);
  }
}

export const need = (creds: Credentials, key: string, label: string): string => {
  const v = creds[key];
  if (!v) throw new CarrierError(`${label} is missing from the stored credentials`, 401);
  return v;
};
