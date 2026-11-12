/**
 * Integration catalog (BUILD_PLAN F4.1; spec 06 §7): 15 sales channels and 13 carriers
 * with logo, brand colour and availability. Logos are inline SVG data (monogram tiles
 * in the brand colour — no third-party trademark artwork is shipped) so the catalog
 * renders without network requests; `logoPath` points at an optional richer asset
 * under `public/logos/**` that the UI may prefer when present.
 */

export type IntegrationKind = "channel" | "carrier";
/** `available`: connectable now; `beta`: connectable, flagged; `coming-soon`: card shown disabled. */
export type IntegrationAvailability = "available" | "beta" | "coming-soon";

export interface IntegrationCatalogEntry {
  readonly key: string;
  readonly name: string;
  readonly kind: IntegrationKind;
  readonly availability: IntegrationAvailability;
  readonly brandColor: string;
  readonly monogram: string;
  readonly logoPath: string;
  /** Self-contained SVG markup (data). */
  readonly logoSvg: string;
  readonly description: string;
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function monogramSvg(monogram: string, color: string): string {
  const size = monogram.length > 2 ? 15 : 18;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" role="img"><rect width="48" height="48" rx="10" fill="${escapeXml(color)}"/><text x="24" y="24" dy=".35em" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-weight="700" font-size="${size}" fill="#fff">${escapeXml(monogram)}</text></svg>`;
}

export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

type Seed = readonly [key: string, name: string, availability: IntegrationAvailability, color: string, monogram: string, description: string];

function build(kind: IntegrationKind, seeds: readonly Seed[]): readonly IntegrationCatalogEntry[] {
  return seeds.map(([key, name, availability, brandColor, monogram, description]) => ({
    key,
    name,
    kind,
    availability,
    brandColor,
    monogram,
    logoPath: `/logos/${kind === "channel" ? "channels" : "carriers"}/${key}.svg`,
    logoSvg: monogramSvg(monogram, brandColor),
    description,
  }));
}

const CHANNEL_SEEDS: readonly Seed[] = [
  ["shopify", "Shopify", "available", "#5E8E3E", "S", "Download orders and products, sync inventory and send shipment info."],
  ["shipstation", "ShipStation", "available", "#84C225", "SS", "Exchange orders and tracking with ShipStation."],
  ["amazon", "Amazon", "available", "#E47911", "A", "Amazon Seller Central merchant-fulfilled orders."],
  ["woocommerce", "WooCommerce", "available", "#7F54B3", "W", "WordPress WooCommerce stores."],
  ["tiktok", "TikTok Shop", "available", "#111111", "TT", "TikTok Shop orders and inventory sync."],
  ["magento", "Magento", "beta", "#EE672F", "M", "Adobe Commerce / Magento 2 stores."],
  ["walmart", "Walmart", "available", "#0071CE", "W", "Walmart Marketplace orders."],
  ["loop-returns", "Loop Returns", "beta", "#1A1A1A", "L", "Create return orders from Loop."],
  ["quickbooks-online", "QuickBooks Online", "coming-soon", "#2CA01C", "QB", "Send billing to QuickBooks Online."],
  ["cartrover", "CartRover", "beta", "#1F6FB2", "CR", "Connect many carts through CartRover."],
  ["squarespace", "Squarespace", "coming-soon", "#222222", "SQ", "Squarespace Commerce stores."],
  ["amazon-fba", "Amazon FBA", "coming-soon", "#FF9900", "FBA", "Replenish Amazon FBA inventory."],
  ["ebay", "eBay", "available", "#0064D2", "e", "eBay marketplace orders."],
  ["bigcommerce", "Big Commerce", "beta", "#121118", "BC", "BigCommerce stores."],
  ["etsy", "Etsy", "available", "#F1641E", "E", "Etsy shop orders."],
];

const CARRIER_SEEDS: readonly Seed[] = [
  ["shipstation", "ShipStation", "available", "#84C225", "SS", "Rate and label through ShipStation carriers."],
  ["ups", "UPS", "available", "#5A3D1E", "UPS", "UPS rates, labels and tracking."],
  ["fedex", "Fedex", "available", "#4D148C", "FX", "FedEx rates, labels and tracking."],
  ["stamps-com", "Stamps.com", "available", "#1E4E9C", "ST", "USPS through Stamps.com."],
  ["easypost", "EasyPost", "available", "#1F4FBF", "EP", "Multi-carrier labels through EasyPost."],
  ["techship", "Techship", "beta", "#0B3D5C", "TS", "European multi-carrier platform."],
  ["custom-carrier", "Custom Carrier", "available", "#475467", "CC", "Your own carrier with manual tracking."],
  ["ehub", "Ehub", "beta", "#00A0DF", "EH", "Discounted rates through Ehub."],
  ["shipium", "Shipium", "coming-soon", "#2D2A8C", "SH", "Carrier selection and promise dates."],
  ["eshipper", "eShipper", "beta", "#E2231A", "ES", "Canadian multi-carrier shipping."],
  ["buku", "BUKU", "coming-soon", "#00B2A9", "BK", "BUKU Ship regional carriers."],
  ["shippo", "Shippo", "available", "#1B3A57", "SP", "Multi-carrier labels through Shippo."],
  ["idrive-logistics", "iDrive Logistics", "coming-soon", "#0E7C3A", "iD", "iDrive Logistics rates."],
];

export const CHANNELS: readonly IntegrationCatalogEntry[] = Object.freeze(build("channel", CHANNEL_SEEDS));
export const CARRIERS: readonly IntegrationCatalogEntry[] = Object.freeze(build("carrier", CARRIER_SEEDS));
export const INTEGRATION_CATALOG: readonly IntegrationCatalogEntry[] = Object.freeze([...CHANNELS, ...CARRIERS]);

export function findIntegration(kind: IntegrationKind, key: string): IntegrationCatalogEntry | undefined {
  const list = kind === "channel" ? CHANNELS : CARRIERS;
  const needle = key.trim().toLowerCase();
  return list.find((e) => e.key === needle || e.name.toLowerCase() === needle);
}

export function isConnectable(entry: IntegrationCatalogEntry): boolean {
  return entry.availability !== "coming-soon";
}
