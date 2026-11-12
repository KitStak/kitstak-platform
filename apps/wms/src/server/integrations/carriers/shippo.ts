/** Shippo adapter (M12): ShippoToken auth + Shipments / Transactions / Refunds; Test env = validated simulation. */
import { CarrierError, type CarrierAddress, type LabelRequest } from "@/server/domain/carriers/adapter";
import { assertPackages, buildCarrierAdapter, carrierFetch, need, type CarrierDef } from "./common";
import type { Credentials } from "../crypto";

const BASE = "https://api.goshippo.com";
const auth = (creds: Credentials) => `ShippoToken ${need(creds, "apiKey", "API token")}`;
const sp = (a: CarrierAddress) => ({ name: a.name, company: a.company ?? "", street1: a.line1, street2: a.line2 ?? "", city: a.city, state: a.state ?? "", zip: a.postalCode, country: a.country.length === 2 ? a.country : "US", phone: a.phone ?? "" });

async function shipment(req: Pick<LabelRequest, "from" | "to" | "packages">, creds: Credentials) {
  return carrierFetch(`${BASE}/shipments/`, { method: "POST", headers: { authorization: auth(creds), "content-type": "application/json" },
    body: JSON.stringify({ address_from: sp(req.from), address_to: sp(req.to), parcels: req.packages.map((p) => ({ length: p.length, width: p.width, height: p.height, distance_unit: "in", weight: p.weightOz, mass_unit: "oz" })), async: false }) });
}

export const SHIPPO_DEF: CarrierDef = {
  provider: "shippo", carrierCode: "USPS", trackingPrefix: "9205", trackingLength: 18,
  credentialFields: [{ key: "apiKey", label: "API token", secret: true }],
  services: [
    { code: "usps_ground_advantage", name: "USPS Ground Advantage", transitDays: 5, base: 4.8, perLb: 0.43 },
    { code: "usps_priority", name: "USPS Priority Mail", transitDays: 3, base: 8, perLb: 0.57 },
    { code: "usps_priority_express", name: "USPS Priority Mail Express", transitDays: 1, base: 28.5, perLb: 1.88 },
    { code: "ups_ground", name: "UPS Ground (Shippo)", transitDays: 5, base: 8.7, perLb: 0.62 },
  ],
  packages: [{ code: "parcel", name: "Parcel" }, { code: "USPS_FlatRateEnvelope", name: "USPS Flat Rate Envelope" }, { code: "USPS_SmallFlatRateBox", name: "USPS Small Flat Rate Box" }],
  validateRequest(from, to, packages) {
    if (!from.line1 || !from.city || !from.postalCode) throw new CarrierError("address_from: street1, city and zip are required", 400);
    if (!to.postalCode) throw new CarrierError("address_to: zip is required", 400);
    assertPackages(packages);
  },
  live: {
    async validate(creds) {
      await carrierFetch(`${BASE}/carrier_accounts/?results=1`, { headers: { authorization: auth(creds) } });
      return "Shippo accepted this API token";
    },
    async rate(req, creds) {
      const body = await shipment(req, creds);
      return ((body.rates as Record<string, unknown>[] | undefined) ?? []).flatMap((r) => {
        const token = String((r.servicelevel as Record<string, unknown>)?.token ?? "");
        const svc = req.services.find((s) => s.serviceCode === token);
        return svc ? [{ carrierServiceId: svc.id, serviceCode: token, serviceName: svc.name, carrierCode: String(r.provider ?? "USPS"), amount: Number(r.amount ?? 0), currency: String(r.currency ?? "USD"), transitDays: Number(r.estimated_days ?? svc.transitDays), zone: String(r.zone ?? ""), estimatedDeliveryAt: new Date(Date.now() + svc.transitDays * 86_400_000).toISOString() }] : [];
      });
    },
    async createLabel(req, creds) {
      const s = await shipment(req, creds);
      const rate = ((s.rates as Record<string, unknown>[] | undefined) ?? []).find((r) => (r.servicelevel as Record<string, unknown>)?.token === req.service.serviceCode);
      if (!rate) throw new CarrierError(`Shippo did not offer ${req.service.name} for this shipment`, 422);
      const tx = await carrierFetch(`${BASE}/transactions/`, { method: "POST", headers: { authorization: auth(creds), "content-type": "application/json" }, body: JSON.stringify({ rate: rate.object_id, label_file_type: req.format === "PDF" ? "PDF_4x6" : "ZPLII", async: false }) });
      if (tx.status !== "SUCCESS") throw new CarrierError(`Shippo label failed: ${JSON.stringify(tx.messages ?? []).slice(0, 300)}`, 422);
      const bytes = new Uint8Array(await (await fetch(String(tx.label_url))).arrayBuffer());
      return { masterTrackingNumber: String(tx.tracking_number), packages: [{ trackingNumber: String(tx.tracking_number), amount: Number(rate.amount ?? 0), label: bytes }], totalAmount: Number(rate.amount ?? 0), currency: "USD", zone: "", estimatedDeliveryAt: new Date(Date.now() + 3 * 86_400_000).toISOString(), format: req.format === "PDF" ? "PDF" : "ZPL" };
    },
    async voidLabel() {
      throw new CarrierError("Shippo refunds need the transaction id; void this label in the Shippo dashboard", 400);
    },
  },
};

export const shippoAdapter = buildCarrierAdapter(SHIPPO_DEF);
