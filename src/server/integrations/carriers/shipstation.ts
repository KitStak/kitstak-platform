/**
 * ShipStation carrier adapter (M12): rates and labels through the carriers connected to a
 * ShipStation account (ShipStation API v1, Basic auth with API key + secret).
 * - validate: `GET /carriers` (lists the account's connected carriers)
 * - rate: `POST /shipments/getrates` once per ShipStation carrier code in the requested services
 * - label: `POST /shipments/createlabel` per package (ShipStation returns a base64 PDF)
 * - void: looks the shipment up by tracking number, then `POST /shipments/voidlabel`
 * Test environment (or no credentials) = the shared validated simulation in `common.ts`.
 */
import { CarrierError, type CarrierAddress, type PackageSpec } from "@/server/domain/carriers/adapter";
import { assertPackages, buildCarrierAdapter, carrierFetch, need, type CarrierDef } from "./common";
import type { Credentials } from "../crypto";
import { mapSeq } from "@/server/db/sql";

const BASE = "https://ssapi.shipstation.com";

export function shipstationAuth(creds: Credentials): string {
  return `Basic ${Buffer.from(`${need(creds, "apiKey", "API key")}:${need(creds, "apiSecret", "API secret")}`).toString("base64")}`;
}

/** ShipStation carrier code for a service code (`usps_priority_mail` → `stamps_com`). Pure; exported for tests. */
export function shipstationCarrierOf(serviceCode: string): string {
  if (serviceCode.startsWith("usps_")) return "stamps_com";
  if (serviceCode.startsWith("ups_")) return "ups_walleted";
  if (serviceCode.startsWith("fedex_")) return "fedex";
  if (serviceCode.startsWith("dhl_")) return "dhl_express_worldwide";
  return serviceCode.split("_")[0] ?? serviceCode;
}

const country = (c: string) => (c.length === 2 ? c.toUpperCase() : "US");
export const ssAddress = (a: CarrierAddress) => ({
  name: a.name, company: a.company ?? null, street1: a.line1, street2: a.line2 ?? null, city: a.city, state: a.state ?? null,
  postalCode: a.postalCode, country: country(a.country), phone: a.phone ?? null, residential: !a.company,
});
const weight = (p: PackageSpec) => ({ value: Math.max(1, Math.round(p.weightOz * 10) / 10), units: "ounces" });
const dims = (p: PackageSpec) => ({ units: "inches", length: p.length, width: p.width, height: p.height });

const json = (creds: Credentials, body: unknown): RequestInit => ({ method: "POST", headers: { authorization: shipstationAuth(creds), "content-type": "application/json" }, body: JSON.stringify(body) });

export const SHIPSTATION_DEF: CarrierDef = {
  provider: "shipstation", carrierCode: "USPS", trackingPrefix: "9400", trackingLength: 18,
  credentialFields: [{ key: "apiKey", label: "API key", secret: true }, { key: "apiSecret", label: "API secret", secret: true }],
  services: [
    { code: "usps_ground_advantage", name: "USPS Ground Advantage (ShipStation)", transitDays: 5, base: 4.75, perLb: 0.42 },
    { code: "usps_priority_mail", name: "USPS Priority Mail (ShipStation)", transitDays: 3, base: 7.9, perLb: 0.56 },
    { code: "usps_priority_mail_express", name: "USPS Priority Mail Express (ShipStation)", transitDays: 1, base: 28.2, perLb: 1.85 },
    { code: "ups_ground", name: "UPS Ground (ShipStation)", transitDays: 5, base: 8.6, perLb: 0.61 },
    { code: "ups_2nd_day_air", name: "UPS 2nd Day Air (ShipStation)", transitDays: 2, base: 17.4, perLb: 1.15 },
    { code: "fedex_ground", name: "FedEx Ground (ShipStation)", transitDays: 5, base: 8.9, perLb: 0.63 },
    { code: "usps_priority_mail_international", name: "USPS Priority Mail International (ShipStation)", transitDays: 8, base: 39.5, perLb: 4.2, international: true },
  ],
  packages: [{ code: "package", name: "Package" }, { code: "flat_rate_envelope", name: "Flat Rate Envelope" }, { code: "small_flat_rate_box", name: "Small Flat Rate Box" }, { code: "medium_flat_rate_box", name: "Medium Flat Rate Box" }],
  validateRequest(from, to, packages) {
    if (!from.postalCode) throw new CarrierError("fromPostalCode is required", 400);
    if (!to.postalCode || !to.country) throw new CarrierError("toPostalCode and toCountry are required", 400);
    if (!to.line1 || !to.city) throw new CarrierError("shipTo.street1 and shipTo.city are required", 400);
    assertPackages(packages);
  },
  live: {
    async validate(creds) {
      const res = await fetch(`${BASE}/carriers`, { headers: { authorization: shipstationAuth(creds) } }).catch(() => null);
      if (!res) throw new CarrierError("Couldn't reach ShipStation", 504);
      if (res.status === 401 || res.status === 403) throw new CarrierError("ShipStation rejected this API key and secret", 401);
      if (!res.ok) throw new CarrierError(`ShipStation answered ${res.status} ${res.statusText}`, res.status);
      const list = (await res.json().catch(() => [])) as unknown;
      const n = Array.isArray(list) ? list.length : 0;
      return `ShipStation accepted these credentials (${n} carrier${n === 1 ? "" : "s"} connected to the account)`;
    },
    async rate(req, creds) {
      const p = req.packages[0];
      if (!p) throw new CarrierError("At least one package is required.", 400);
      const byCarrier = new Map<string, typeof req.services[number][]>();
      for (const svc of req.services) {
        const code = shipstationCarrierOf(svc.serviceCode);
        byCarrier.set(code, [...(byCarrier.get(code) ?? []), svc]);
      }
      const quotes = await Promise.all(await mapSeq([...byCarrier], async ([carrierCode, services]) => {
        const res = await fetch(`${BASE}/shipments/getrates`, json(creds, {
          carrierCode, serviceCode: null, packageCode: null, fromPostalCode: req.from.postalCode, toState: req.to.state ?? null, toCountry: country(req.to.country),
          toPostalCode: req.to.postalCode, toCity: req.to.city, weight: weight(p), dimensions: dims(p), confirmation: "none", residential: !req.to.company,
        }));
        if (!res.ok) throw new CarrierError(`ShipStation rates (${carrierCode}) failed: ${res.status} ${(await res.text()).slice(0, 300)}`, res.status);
        const rows = (await res.json()) as { serviceCode?: string; serviceName?: string; shipmentCost?: number; otherCost?: number }[];
        return rows.flatMap((r) => {
          const svc = services.find((x) => x.serviceCode === r.serviceCode);
          if (!svc) return [];
          const amount = Math.round(((r.shipmentCost ?? 0) + (r.otherCost ?? 0)) * req.packages.length * 100) / 100;
          return [{ carrierServiceId: svc.id, serviceCode: svc.serviceCode, serviceName: svc.name, carrierCode: carrierCode.toUpperCase(), amount, currency: "USD", transitDays: svc.transitDays, zone: "", estimatedDeliveryAt: new Date(Date.now() + svc.transitDays * 86_400_000).toISOString() }];
        });
      }));
      return quotes.flat();
    },
    async createLabel(req, creds) {
      const carrierCode = shipstationCarrierOf(req.service.serviceCode);
      const packages = [];
      for (const p of req.packages) {
        const body = await carrierFetch(`${BASE}/shipments/createlabel`, json(creds, {
          carrierCode, serviceCode: req.service.serviceCode, packageCode: "package", confirmation: "none", shipDate: req.shipDate.slice(0, 10),
          weight: weight(p), dimensions: dims(p), shipFrom: ssAddress(req.from), shipTo: ssAddress(req.to), testLabel: false,
          advancedOptions: { customField1: req.orderCode },
        }));
        const data = typeof body.labelData === "string" ? body.labelData : "";
        if (!data || typeof body.trackingNumber !== "string") throw new CarrierError("ShipStation returned no label", 502);
        packages.push({ trackingNumber: body.trackingNumber, amount: Number(body.shipmentCost ?? 0) + Number(body.insuranceCost ?? 0), label: new Uint8Array(Buffer.from(data, "base64")) });
      }
      const total = Math.round(packages.reduce((s, x) => s + x.amount, 0) * 100) / 100;
      return {
        masterTrackingNumber: packages[0]?.trackingNumber ?? "", packages, totalAmount: total, currency: "USD", zone: "",
        estimatedDeliveryAt: new Date(Date.parse(req.shipDate) + req.service.transitDays * 86_400_000).toISOString(), format: "PDF",
      };
    },
    async voidLabel(req, creds) {
      const found = await carrierFetch(`${BASE}/shipments?trackingNumber=${encodeURIComponent(req.trackingNumber)}&includeShipmentItems=false`, { headers: { authorization: shipstationAuth(creds) } });
      const shipment = ((found.shipments as { shipmentId?: number; voided?: boolean }[] | undefined) ?? [])[0];
      if (!shipment?.shipmentId) throw new CarrierError(`ShipStation has no shipment with tracking ${req.trackingNumber}`, 404);
      if (shipment.voided) return { voided: true, message: "Already voided in ShipStation" };
      const res = await carrierFetch(`${BASE}/shipments/voidlabel`, json(creds, { shipmentId: shipment.shipmentId }));
      return { voided: res.approved === true, message: typeof res.message === "string" ? res.message : undefined };
    },
  },
};

export const shipstationCarrierAdapter = buildCarrierAdapter(SHIPSTATION_DEF);
