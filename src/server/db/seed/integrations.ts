/**
 * Integrations configuration: carrier connections (KitStak Sandbox per warehouse, UPS-TEST),
 * services, packages, client markups; sales channel connections, methods, location mappings
 * and product listings (incl. unlinked and SKU-difference listings).
 */
import { SANDBOX_CARRIER_NAME } from "@/config/brand";
import { SANDBOX_PROVIDER, SANDBOX_SERVICES } from "@/server/domain/carriers/sandbox";
import * as schema from "@/server/db/schema";
import type { Tx } from "@/server/domain/types";
import { CHANNEL_METHODS } from "@/lib/enums";
import type { CatalogRefs } from "./catalog";
import type { OrgRefs } from "./org";
import { isoOf, utcAt } from "./runtime";
import type { Id } from "./types";

export interface CarrierRefs {
  /** Sandbox connection id per warehouse id. */
  readonly sandboxByWarehouse: ReadonlyMap<Id, Id>;
  /** Sandbox service id by `${connectionId}|${serviceCode}`. */
  readonly services: ReadonlyMap<string, Id>;
  readonly upsTest: Id;
}

export interface ChannelRef {
  readonly id: Id;
  readonly clientId: Id;
  readonly storeName: string;
  readonly provider: "shopify" | "shipstation";
  readonly methods: ReadonlyMap<(typeof CHANNEL_METHODS)[number], Id>;
}

export interface ChannelRefs {
  readonly connections: readonly ChannelRef[];
  /** Channel connection id by client id (orders from that client's store). */
  readonly byClient: ReadonlyMap<Id, ChannelRef>;
}

export const serviceKey = (connectionId: Id, code: string): string => `${connectionId}|${code}`;

const SANDBOX_PACKAGES = [["Your Packaging", "CUSTOM"], ["UPS Letter", "UPS_LETTER"], ["USPS Flat Rate Envelope", "USPS_FRE"], ["USPS Padded Flat Rate Envelope", "USPS_PFRE"]] as const;

function seedSandbox(tx: Tx, warehouseId: Id, code: string, services: Map<string, Id>): Id {
  const id = tx.insert(schema.carrierConnections).values({
    provider: SANDBOX_PROVIDER, setupName: SANDBOX_CARRIER_NAME, accountPrefix: `KSB-${code}`, warehouseId, environment: "Production",
    payorAccountNumber: `KSB${code}0042`, settings: { label: { format: "PDF", size: "4x6", messages: ["Thank you for your order"] } },
    createdAt: isoOf(utcAt(200, 15)),
  }).returning({ id: schema.carrierConnections.id }).get().id;
  for (const s of SANDBOX_SERVICES) {
    const sid = tx.insert(schema.carrierServices).values({
      connectionId: id, carrierCode: s.carrierCode, serviceCode: s.code, name: `${s.carrierCode} ${s.name}`, transitDays: s.transitDays,
      isInternational: Boolean(s.international),
    }).returning({ id: schema.carrierServices.id }).get().id;
    services.set(serviceKey(id, s.code), sid);
  }
  tx.insert(schema.carrierPackages).values(SANDBOX_PACKAGES.map(([name, pkgCode]) => ({ connectionId: id, name, code: pkgCode }))).run();
  return id;
}

function seedUpsTest(tx: Tx, warehouseId: Id): Id {
  const id = tx.insert(schema.carrierConnections).values({
    provider: "ups", setupName: "UPS-TEST", accountPrefix: "UPS-T", warehouseId, environment: "Test", payorAccountNumber: "A1B2C3",
    allClients: false, settings: { label: { format: "ZPL", size: "4x6", messages: [] } }, createdAt: isoOf(utcAt(45, 19)),
  }).returning({ id: schema.carrierConnections.id }).get().id;
  const ups = [["03", "UPS Ground", 5, false], ["02", "UPS 2nd Day Air", 2, false], ["01", "UPS Next Day Air", 1, false], ["65", "UPS Worldwide Saver", 4, true]] as const;
  tx.insert(schema.carrierServices).values(ups.map(([serviceCode, name, transitDays, isInternational]) => ({ connectionId: id, carrierCode: "UPS", serviceCode, name, transitDays, isInternational }))).run();
  tx.insert(schema.carrierPackages).values([{ connectionId: id, name: "Customer Supplied Package", code: "02" }, { connectionId: id, name: "UPS Pak", code: "04" }]).run();
  tx.insert(schema.carrierThirdPartyAccounts).values({ connectionId: id, accountNumber: "9W2X44", billingCountry: "United States", billingZip: "60607" }).run();
  return id;
}

export function seedCarriers(tx: Tx, org: OrgRefs): CarrierRefs {
  const services = new Map<string, Id>();
  const mlt1 = seedSandbox(tx, org.mlt1, "MLT1", services);
  const ks2 = seedSandbox(tx, org.ks2, "KS2", services);
  const upsTest = seedUpsTest(tx, org.mlt1);
  const apx = org.clientByCode.get("APX");
  const nova = org.clientByCode.get("NVF");
  if (apx) tx.insert(schema.carrierConnectionClients).values({ connectionId: mlt1, clientId: apx.id, markupType: "Percentage", markupAmount: 8 }).run();
  if (nova) {
    tx.insert(schema.carrierConnectionClients).values({ connectionId: mlt1, clientId: nova.id, markupType: "Fixed Price", markupAmount: 0.75 }).run();
    tx.insert(schema.carrierConnectionClients).values({ connectionId: upsTest, clientId: nova.id }).run();
  }
  return { sandboxByWarehouse: new Map([[org.mlt1, mlt1], [org.ks2, ks2]]), services, upsTest };
}

const CHANNEL_SPECS = [
  { clientCode: "APX", provider: "shopify", storeName: "Apex Threads Shopify", interval: 15 },
  { clientCode: "BLB", provider: "shopify", storeName: "Bluebird & Main Shopify", interval: 15 },
  { clientCode: "NVF", provider: "shipstation", storeName: "NovaForge ShipStation", interval: 30 },
] as const;

const METHOD_INTERVALS: Readonly<Record<(typeof CHANNEL_METHODS)[number], number>> = {
  "Download Orders": 15, "Download Products": 1440, "Sync Inventory": 60, "Send Shipment Info": 30,
};

function seedListings(tx: Tx, conn: ChannelRef, catalog: CatalogRefs, withExceptions: boolean): void {
  const products = catalog.products.filter((p) => p.clientId === conn.clientId && !p.isPackaging);
  products.forEach((p, i) => {
    const skuDifference = withExceptions && (i === 1 || i === 4);
    tx.insert(schema.productListings).values({
      channelConnectionId: conn.id, clientId: conn.clientId, productId: p.id, sellerSku: skuDifference ? p.sku.replaceAll("-", "") : p.sku,
      channelProductId: String(8_104_220_000 + i * 131), name: p.name, storePrice: p.price, linkedAt: isoOf(utcAt(150 - i, 15)),
      lastSyncedQty: null, neverSync: i === products.length - 1,
    }).run();
  });
  if (!withExceptions) return;
  const unlinked = conn.provider === "shopify"
    ? [["APX-TEE-GRN-M", "Apex Classic Tee - Forest Green / M", 24], ["APX-TEE-GRN-L", "Apex Classic Tee - Forest Green / L", 24], ["APX-GIFT-CARD-50", "Apex Threads $50 Gift Card", 50]] as const
    : [["NOVA-CBL-USBC-05M", "NovaForge USB-C Cable 0.5m", 12], ["NOVA-CHG-100W", "NovaForge 100W GaN Charger", 79], ["NOVA-ADP-HDMI", "NovaForge USB-C to HDMI Adapter", 24]] as const;
  unlinked.slice(0, conn.provider === "shopify" ? 3 : 0).forEach(([sellerSku, name, price], i) => {
    tx.insert(schema.productListings).values({
      channelConnectionId: conn.id, clientId: conn.clientId, productId: null, sellerSku, channelProductId: String(8_104_990_000 + i * 17), name, storePrice: price,
    }).run();
  });
}

export function seedChannels(tx: Tx, org: OrgRefs, catalog: CatalogRefs): ChannelRefs {
  const connections = CHANNEL_SPECS.flatMap((spec, ci): ChannelRef[] => {
    const client = org.clientByCode.get(spec.clientCode);
    if (!client) return [];
    const id = tx.insert(schema.channelConnections).values({
      provider: spec.provider, storeName: spec.storeName, clientId: client.id, distribution: "Custom App", authMethod: "Access Token",
      apiVersion: spec.provider === "shopify" ? "GraphQL" : "Rest API", status: "Completed",
      settings: {
        paymentStatuses: ["paid"], products: { download: true, uom: "Each" },
        orders: { download: true, shipmentOrderType: "D2C Order", skipAddressVerification: false },
        inventory: { sync: true, method: "Available" }, shipments: { sendShipmentInfo: true },
      },
      createdAt: isoOf(utcAt(180 - ci * 20, 16)),
    }).returning({ id: schema.channelConnections.id }).get().id;
    tx.insert(schema.channelLocationMappings).values({ connectionId: id, channelLocationId: `gid://loc/${71_200 + ci}`, channelLocationName: "Louisville Fulfillment Center", warehouseId: org.mlt1 }).run();
    const methods = new Map(CHANNEL_METHODS.map((method) => {
      const interval = method === "Download Orders" ? spec.interval : METHOD_INTERVALS[method];
      const mid = tx.insert(schema.channelMethods).values({
        connectionId: id, method, intervalMinutes: interval, status: spec.clientCode === "BLB" && method === "Download Products" ? "Passive" : "Active",
      }).returning({ id: schema.channelMethods.id }).get().id;
      return [method, mid] as const;
    }));
    return [{ id, clientId: client.id, storeName: spec.storeName, provider: spec.provider, methods }];
  });
  // Listings for two connections: APX Shopify (3 unlinked + 2 SKU differences) and NovaForge ShipStation.
  const [apx, , nova] = connections;
  if (apx) seedListings(tx, apx, catalog, true);
  if (nova) seedListings(tx, nova, catalog, false);
  return { connections, byClient: new Map(connections.map((c) => [c.clientId, c])) };
}
