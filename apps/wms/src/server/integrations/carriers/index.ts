/**
 * M12 carrier adapters. Importing this module registers UPS, FedEx, EasyPost, Shippo, Stamps.com,
 * ShipStation and Custom Carrier with the
 * foundation carrier registry (the KitStak Sandbox is registered by foundation).
 */
import { registerCarrierAdapter } from "@/server/domain/carriers";
import { SANDBOX_PROVIDER, SANDBOX_SERVICES } from "@/server/domain/carriers/sandbox";
import type { CarrierDef } from "./common";
import { EASYPOST_DEF, easypostAdapter } from "./easypost";
import { FEDEX_DEF, fedexAdapter } from "./fedex";
import { SHIPPO_DEF, shippoAdapter } from "./shippo";
import { UPS_DEF, upsAdapter } from "./ups";
import { CUSTOM_DEF, customAdapter } from "./custom";
import { STAMPS_DEF, stampsAdapter } from "./stamps";
import { SHIPSTATION_DEF, shipstationCarrierAdapter } from "./shipstation";

for (const adapter of [upsAdapter, fedexAdapter, easypostAdapter, shippoAdapter, stampsAdapter, shipstationCarrierAdapter, customAdapter]) registerCarrierAdapter(adapter);

export const CARRIER_DEFS: Readonly<Record<string, CarrierDef>> = { ups: UPS_DEF, fedex: FEDEX_DEF, easypost: EASYPOST_DEF, shippo: SHIPPO_DEF, "usps-stamps": STAMPS_DEF, shipstation: SHIPSTATION_DEF, custom: CUSTOM_DEF };

export interface CatalogService { readonly carrierCode: string; readonly code: string; readonly name: string; readonly transitDays: number; readonly international: boolean }

/** Services / packages a new connection starts with, and the credential fields it asks for. */
export function providerCatalog(provider: string): { services: readonly CatalogService[]; packages: readonly { code: string; name: string }[]; credentialFields: CarrierDef["credentialFields"]; live: boolean } {
  if (provider === SANDBOX_PROVIDER) {
    return {
      services: SANDBOX_SERVICES.map((s) => ({ carrierCode: s.carrierCode, code: s.code, name: `${s.carrierCode} ${s.name}`, transitDays: s.transitDays, international: Boolean(s.international) })),
      packages: [{ code: "SBX_BOX", name: "Customer Box" }, { code: "SBX_POLY", name: "Poly Mailer" }, { code: "SBX_ENV", name: "Envelope" }],
      credentialFields: [], live: true,
    };
  }
  const def = CARRIER_DEFS[provider];
  if (!def) return { services: [], packages: [], credentialFields: [{ key: "apiKey", label: "API key", secret: true }, { key: "apiSecret", label: "API secret", secret: true }], live: false };
  return {
    services: def.services.map((s) => ({ carrierCode: def.carrierCode, code: s.code, name: s.name, transitDays: s.transitDays, international: Boolean(s.international) })),
    packages: def.packages, credentialFields: def.credentialFields, live: true,
  };
}

export const ensureCarrierAdapters = (): number => CARRIER_DEFS ? Object.keys(CARRIER_DEFS).length : 0;
