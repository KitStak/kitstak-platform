/**
 * Stamps.com adapter (M12): USPS through the Stamps.com SERA REST API.
 * Auth: OAuth client ID + secret and the account's refresh token (exchanged per call for an
 * access token). Test environment = validated simulation (USPS rules: ship-to ZIP, weight caps).
 */
import { CarrierError, type CarrierAddress, type LabelRequest, type RateRequest } from "@/server/domain/carriers/adapter";
import { assertPackages, buildCarrierAdapter, carrierFetch, need, type CarrierDef } from "./common";
import type { Credentials } from "../crypto";

const host = (env: string) => (env === "Production" ? "https://api.stampsendicia.com/sera" : "https://api.testing.stampsendicia.com/sera");
const auth = (env: string) => (env === "Production" ? "https://signin.stampsendicia.com/oauth/token" : "https://signin.testing.stampsendicia.com/oauth/token");
const MAX_OZ = 70 * 16;

async function token(env: string, creds: Credentials): Promise<string> {
  const body = await carrierFetch(auth(env), {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant_type: "refresh_token", client_id: need(creds, "clientId", "Client ID"), client_secret: need(creds, "clientSecret", "Client secret"), refresh_token: need(creds, "refreshToken", "Refresh token") }),
  });
  const t = body.access_token;
  if (typeof t !== "string") throw new CarrierError("Stamps.com did not return an access token", 401);
  return t;
}

const addr = (a: CarrierAddress) => ({
  name: a.name, company_name: a.company ?? undefined, address_line1: a.line1, address_line2: a.line2 ?? undefined, city: a.city, state_province: a.state ?? "",
  postal_code: a.postalCode, country_code: a.country.length === 2 ? a.country : "US", phone: a.phone ?? undefined,
});
const pkg = (p: RateRequest["packages"][number]) => ({ packaging_type: "package", weight: p.weightOz, weight_unit: "ounce", length: p.length, width: p.width, height: p.height, dimension_unit: "inch" });

export const STAMPS_DEF: CarrierDef = {
  provider: "usps-stamps", carrierCode: "USPS", trackingPrefix: "9400", trackingLength: 18,
  credentialFields: [{ key: "clientId", label: "Client ID", secret: false }, { key: "clientSecret", label: "Client secret", secret: true }, { key: "refreshToken", label: "Refresh token", secret: true }],
  services: [
    { code: "usps_ground_advantage", name: "USPS Ground Advantage", transitDays: 5, base: 4.75, perLb: 0.42 },
    { code: "usps_priority_mail", name: "USPS Priority Mail", transitDays: 3, base: 7.9, perLb: 0.56 },
    { code: "usps_priority_mail_express", name: "USPS Priority Mail Express", transitDays: 1, base: 28, perLb: 1.85 },
    { code: "usps_media_mail", name: "USPS Media Mail", transitDays: 6, base: 3.9, perLb: 0.7 },
    { code: "usps_first_class_mail_international", name: "USPS First-Class Mail International", transitDays: 10, base: 15, perLb: 3.2, international: true },
    { code: "usps_priority_mail_international", name: "USPS Priority Mail International", transitDays: 8, base: 44, perLb: 4.1, international: true },
    { code: "usps_priority_mail_express_international", name: "USPS Priority Mail Express International", transitDays: 4, base: 58, perLb: 5, international: true },
  ],
  packages: [
    { code: "package", name: "Package" }, { code: "large_envelope", name: "Large Envelope / Flat" }, { code: "flat_rate_envelope", name: "Flat Rate Envelope" },
    { code: "padded_flat_rate_envelope", name: "Padded Flat Rate Envelope" }, { code: "small_flat_rate_box", name: "Small Flat Rate Box" },
    { code: "medium_flat_rate_box", name: "Medium Flat Rate Box" }, { code: "large_flat_rate_box", name: "Large Flat Rate Box" }, { code: "regional_rate_box_a", name: "Regional Rate Box A" },
  ],
  validateRequest(from, to, packages) {
    assertPackages(packages);
    if (!from.postalCode || !from.line1) throw new CarrierError("from_address: address_line1 and postal_code are required", 400);
    if (!to.postalCode) throw new CarrierError("to_address: postal_code is required", 400);
    if (packages.some((p) => p.weightOz > MAX_OZ)) throw new CarrierError("USPS packages cannot exceed 70 lb", 400);
  },
  live: {
    async validate(creds, env) {
      await token(env, creds);
      return "Stamps.com accepted these credentials";
    },
    async rate(req, creds) {
      const env = req.connection.environment;
      const t = await token(env, creds);
      const out = [];
      for (const p of req.packages.slice(0, 1)) {
        const rates = await carrierFetch(`${host(env)}/v1/rates`, {
          method: "POST", headers: { authorization: `Bearer ${t}`, "content-type": "application/json" },
          body: JSON.stringify({ from_address: addr(req.from), to_address: addr(req.to), package: pkg(p), ship_date: new Date().toISOString().slice(0, 10), carrier: "usps" }),
        });
        const list = (Array.isArray(rates) ? rates : (rates.rates as unknown[] | undefined) ?? []) as Record<string, unknown>[];
        for (const r of list) {
          const code = String(r.service_type ?? "");
          const svc = req.services.find((s) => s.serviceCode === code);
          if (!svc) continue;
          const amount = Number((r.shipment_cost as Record<string, unknown> | undefined)?.total_amount ?? r.total_amount ?? 0);
          out.push({ carrierServiceId: svc.id, serviceCode: code, serviceName: svc.name, carrierCode: "USPS", amount, currency: "USD", transitDays: svc.transitDays, zone: String(r.zone ?? ""), estimatedDeliveryAt: new Date(Date.now() + svc.transitDays * 86_400_000).toISOString() });
        }
      }
      return out;
    },
    async createLabel(req: LabelRequest, creds) {
      const env = req.connection.environment;
      const t = await token(env, creds);
      const first = req.packages[0];
      if (!first) throw new CarrierError("At least one package is required.", 400);
      const body = await carrierFetch(`${host(env)}/v1/labels`, {
        method: "POST", headers: { authorization: `Bearer ${t}`, "content-type": "application/json", "Idempotency-Key": `${req.orderCode}-${req.attempt}` },
        body: JSON.stringify({
          from_address: addr(req.from), to_address: addr(req.to), service_type: req.service.serviceCode, package: pkg(first), ship_date: req.shipDate.slice(0, 10),
          label_options: { label_size: "4x6", label_format: req.format === "PDF" ? "pdf" : "zpl", label_output_type: "base64" }, references: { reference1: req.orderCode },
        }),
      });
      const trackingNumber = String(body.tracking_number ?? "");
      const labels = (body.labels as Record<string, unknown>[] | undefined) ?? [];
      const label = Buffer.from(String(labels[0]?.label_data ?? body.label_data ?? ""), "base64");
      const total = Number((body.shipment_cost as Record<string, unknown> | undefined)?.total_amount ?? 0);
      return {
        masterTrackingNumber: trackingNumber, packages: [{ trackingNumber, amount: total, label }], totalAmount: total, currency: "USD", zone: String(body.zone ?? ""),
        estimatedDeliveryAt: new Date(Date.now() + req.service.transitDays * 86_400_000).toISOString(), format: req.format === "PDF" ? "PDF" : "ZPL",
      };
    },
    async voidLabel(req, creds) {
      const env = req.connection.environment;
      const t = await token(env, creds);
      await carrierFetch(`${host(env)}/v1/labels/${encodeURIComponent(req.trackingNumber)}/void`, { method: "POST", headers: { authorization: `Bearer ${t}` } });
      return { voided: true };
    },
  },
};

export const stampsAdapter = buildCarrierAdapter(STAMPS_DEF);
