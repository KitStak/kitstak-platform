/**
 * Static pools + deterministic PRNG used by the seed script.
 * Everything here is pure data / pure functions — no DB access.
 */

/* ============ deterministic PRNG ============ */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return (): number => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private readonly next: () => number;

  constructor(seed: number) {
    this.next = mulberry32(seed);
  }

  float(): number {
    return this.next();
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)];
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  digits(length: number): string {
    let out = "";
    for (let i = 0; i < length; i += 1) {
      out += String(this.int(0, 9));
    }
    return out;
  }

  /** Weighted pick: [value, weight][] */
  weighted<T>(entries: ReadonlyArray<readonly [T, number]>): T {
    const totalWeight = entries.reduce((acc, [, w]) => acc + w, 0);
    let roll = this.next() * totalWeight;
    for (const [value, weight] of entries) {
      roll -= weight;
      if (roll <= 0) return value;
    }
    return entries[entries.length - 1][0];
  }
}

/* ============ clients ============ */

export interface ClientSeed {
  code: string;
  name: string;
  contactName: string;
  contactEmail: string;
  phone: string;
  billingPlan: "per-order" | "per-unit" | "monthly";
  status: "Active" | "Inactive";
  category: "apparel" | "electronics" | "coffee";
}

export const CLIENT_SEEDS: readonly ClientSeed[] = [
  { code: "APX", name: "Apex Threads Co.", contactName: "Dana Whitfield", contactEmail: "dana@apexthreads.com", phone: "(312) 555-0142", billingPlan: "per-order", status: "Active", category: "apparel" },
  { code: "NVF", name: "NovaForge Electronics", contactName: "Marcus Oyelaran", contactEmail: "marcus@novaforge.io", phone: "(415) 555-0177", billingPlan: "per-unit", status: "Active", category: "electronics" },
  { code: "CPL", name: "Copperline Coffee Co.", contactName: "Elena Vásquez", contactEmail: "elena@copperlinecoffee.com", phone: "(503) 555-0121", billingPlan: "monthly", status: "Active", category: "coffee" },
  { code: "BLB", name: "Bluebird & Main", contactName: "Priya Raghavan", contactEmail: "priya@bluebirdandmain.com", phone: "(617) 555-0168", billingPlan: "per-order", status: "Active", category: "apparel" },
  { code: "VLT", name: "Voltbyte Labs", contactName: "Tom Keller", contactEmail: "tkeller@voltbyte.com", phone: "(206) 555-0193", billingPlan: "per-unit", status: "Active", category: "electronics" },
  { code: "SMT", name: "Summit Trail Gear", contactName: "Jess Monroe", contactEmail: "jess@summittrailgear.com", phone: "(720) 555-0115", billingPlan: "monthly", status: "Active", category: "apparel" },
  { code: "HRB", name: "Harbor Roast Collective", contactName: "Owen Caldwell", contactEmail: "owen@harborroast.com", phone: "(401) 555-0130", billingPlan: "per-order", status: "Active", category: "coffee" },
  { code: "PXP", name: "Pixel & Pine", contactName: "Sofia Lindqvist", contactEmail: "sofia@pixelandpine.co", phone: "(646) 555-0186", billingPlan: "per-unit", status: "Inactive", category: "electronics" },
];

/* ============ products ============ */

export interface ProductSeed {
  clientCode: string;
  sku: string;
  name: string;
  category: string;
  price: number;
  weightOz: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  isKit: boolean;
  isFragile: boolean;
}

interface ProductTemplate {
  sku: string;
  name: string;
  price: number;
  weightOz: number;
  dims: readonly [number, number, number];
  isKit?: boolean;
  isFragile?: boolean;
}

function product(
  clientCode: string,
  category: string,
  t: ProductTemplate
): ProductSeed {
  return {
    clientCode,
    sku: t.sku,
    name: t.name,
    category,
    price: t.price,
    weightOz: t.weightOz,
    lengthIn: t.dims[0],
    widthIn: t.dims[1],
    heightIn: t.dims[2],
    isKit: t.isKit ?? false,
    isFragile: t.isFragile ?? false,
  };
}

export function buildProductSeeds(): ProductSeed[] {
  const out: ProductSeed[] = [];

  // APX — apparel: classic tee, 3 colors × 4 sizes (12)
  const teeColors: ReadonlyArray<readonly [string, string]> = [
    ["BLK", "Black"],
    ["WHT", "White"],
    ["NVY", "Navy"],
  ];
  const sizes = ["S", "M", "L", "XL"] as const;
  for (const [cc, colorName] of teeColors) {
    for (const size of sizes) {
      out.push(
        product("APX", "Apparel", {
          sku: `APX-TEE-${cc}-${size}`,
          name: `Apex Classic Tee — ${colorName} / ${size}`,
          price: 24,
          weightOz: 6.4,
          dims: [10, 8, 1],
        })
      );
    }
  }

  // BLB — apparel: hoodie 2 colors × 3 sizes + 2 caps (8)
  for (const [cc, colorName] of [["GRY", "Heather Gray"], ["BLK", "Black"]] as const) {
    for (const size of ["M", "L", "XL"] as const) {
      out.push(
        product("BLB", "Apparel", {
          sku: `BLB-HOOD-${cc}-${size}`,
          name: `Bluebird Fleece Hoodie — ${colorName} / ${size}`,
          price: 58,
          weightOz: 19,
          dims: [13, 11, 3],
        })
      );
    }
  }
  out.push(product("BLB", "Apparel", { sku: "BLB-CAP-OS-BLK", name: "Bluebird Dad Cap — Black", price: 28, weightOz: 4, dims: [8, 7, 4] }));
  out.push(product("BLB", "Apparel", { sku: "BLB-CAP-OS-KHK", name: "Bluebird Dad Cap — Khaki", price: 28, weightOz: 4, dims: [8, 7, 4] }));

  // SMT — apparel: trail jacket 2 colors × 3 sizes + socks + headband (8)
  for (const [cc, colorName] of [["OLV", "Olive"], ["BLK", "Black"]] as const) {
    for (const size of ["M", "L", "XL"] as const) {
      out.push(
        product("SMT", "Apparel", {
          sku: `SMT-JKT-${cc}-${size}`,
          name: `Summit Shell Jacket — ${colorName} / ${size}`,
          price: 129,
          weightOz: 15,
          dims: [14, 11, 2.5],
        })
      );
    }
  }
  out.push(product("SMT", "Apparel", { sku: "SMT-SOCK-WOOL-3PK", name: "Summit Merino Crew Socks (3-Pack)", price: 36, weightOz: 7, dims: [9, 5, 2] }));
  out.push(product("SMT", "Apparel", { sku: "SMT-BND-OS", name: "Summit Trail Headband — One Size", price: 16, weightOz: 1.6, dims: [6, 4, 1] }));

  // NVF — electronics: cables, chargers, hubs, power banks (10)
  const novaItems: readonly ProductTemplate[] = [
    { sku: "NOVA-CBL-USBC-1M", name: "NovaForge USB-C Cable 1m — Braided", price: 14, weightOz: 2.1, dims: [4, 4, 1] },
    { sku: "NOVA-CBL-USBC-2M", name: "NovaForge USB-C Cable 2m — Braided", price: 18, weightOz: 3.2, dims: [4, 4, 1.2] },
    { sku: "NOVA-CBL-USBC-3M", name: "NovaForge USB-C Cable 3m — Braided", price: 22, weightOz: 4.4, dims: [5, 5, 1.2] },
    { sku: "NOVA-CBL-LTG-1M", name: "NovaForge Lightning Cable 1m", price: 16, weightOz: 2, dims: [4, 4, 1] },
    { sku: "NOVA-CBL-LTG-2M", name: "NovaForge Lightning Cable 2m", price: 20, weightOz: 3, dims: [4, 4, 1.2] },
    { sku: "NOVA-CHG-65W", name: "NovaForge 65W GaN Wall Charger", price: 49, weightOz: 4.6, dims: [3, 3, 2], isFragile: true },
    { sku: "NOVA-CHG-30W", name: "NovaForge 30W Compact Charger", price: 29, weightOz: 2.8, dims: [2.5, 2.5, 1.5], isFragile: true },
    { sku: "NOVA-HUB-7P", name: "NovaForge 7-Port USB-C Hub", price: 64, weightOz: 5.5, dims: [5, 2.5, 0.8], isFragile: true },
    { sku: "NOVA-PWB-10K", name: "NovaForge PowerCell 10,000mAh", price: 39, weightOz: 8.1, dims: [5.5, 2.8, 0.9], isFragile: true },
    { sku: "NOVA-PWB-20K", name: "NovaForge PowerCell 20,000mAh", price: 59, weightOz: 14.6, dims: [6, 3, 1.1], isFragile: true },
  ];
  for (const t of novaItems) out.push(product("NVF", "Electronics", t));

  // VLT — electronics: audio + desk gear incl. a kit (9)
  const vltItems: readonly ProductTemplate[] = [
    { sku: "VLT-EBD-PRO", name: "Voltbyte Earbuds Pro — ANC", price: 129, weightOz: 2.4, dims: [3, 3, 1.4], isFragile: true },
    { sku: "VLT-EBD-LITE", name: "Voltbyte Earbuds Lite", price: 59, weightOz: 2, dims: [3, 3, 1.3], isFragile: true },
    { sku: "VLT-SPK-MINI", name: "Voltbyte Mini Speaker — Slate", price: 45, weightOz: 9.5, dims: [4, 4, 4], isFragile: true },
    { sku: "VLT-SPK-XL", name: "Voltbyte XL Speaker — Slate", price: 119, weightOz: 32, dims: [8, 4.5, 4.5], isFragile: true },
    { sku: "VLT-MSE-WRLS", name: "Voltbyte Wireless Mouse", price: 34, weightOz: 3.6, dims: [4.5, 2.8, 1.6] },
    { sku: "VLT-KBD-MECH", name: "Voltbyte Mechanical Keyboard 75%", price: 99, weightOz: 28, dims: [13, 5.5, 1.6], isFragile: true },
    { sku: "VLT-WCM-1080", name: "Voltbyte 1080p Webcam", price: 49, weightOz: 4.2, dims: [3.5, 2, 2], isFragile: true },
    { sku: "VLT-STAND-LPT", name: "Voltbyte Aluminum Laptop Stand", price: 44, weightOz: 22, dims: [10, 9, 2] },
    { sku: "VLT-KIT-DESK", name: "Voltbyte Desk Setup Kit (Mouse + Keyboard + Stand)", price: 159, weightOz: 54, dims: [14, 10, 4], isKit: true },
  ];
  for (const t of vltItems) out.push(product("VLT", "Electronics", t));

  // PXP — electronics accessories incl. a kit (8)
  const pxpItems: readonly ProductTemplate[] = [
    { sku: "PXP-CASE-IP15", name: "Pixel & Pine Walnut Case — iPhone 15", price: 42, weightOz: 1.8, dims: [6.5, 3.5, 0.6] },
    { sku: "PXP-CASE-IP16", name: "Pixel & Pine Walnut Case — iPhone 16", price: 42, weightOz: 1.8, dims: [6.5, 3.5, 0.6] },
    { sku: "PXP-SCR-IP15", name: "Pixel & Pine Glass Screen Protector — iPhone 15", price: 18, weightOz: 1, dims: [7, 4, 0.3], isFragile: true },
    { sku: "PXP-SCR-IP16", name: "Pixel & Pine Glass Screen Protector — iPhone 16", price: 18, weightOz: 1, dims: [7, 4, 0.3], isFragile: true },
    { sku: "PXP-GRIP-POP", name: "Pixel & Pine Phone Grip — Ash", price: 14, weightOz: 0.8, dims: [3, 3, 1] },
    { sku: "PXP-MNT-CAR", name: "Pixel & Pine MagSafe Car Mount", price: 34, weightOz: 4.5, dims: [4, 3, 3] },
    { sku: "PXP-CHG-MAG", name: "Pixel & Pine Magnetic Charging Puck", price: 29, weightOz: 2.2, dims: [3.5, 3.5, 0.8], isFragile: true },
    { sku: "PXP-KIT-TRAVEL", name: "Pixel & Pine Travel Kit (Case + Puck + Cable)", price: 79, weightOz: 6.5, dims: [8, 5, 2], isKit: true },
  ];
  for (const t of pxpItems) out.push(product("PXP", "Electronics", t));

  // CPL — coffee incl. sampler kit (8)
  const cplItems: readonly ProductTemplate[] = [
    { sku: "CPL-BAG-ESP-12", name: "Copperline Espresso Blend — 12oz Whole Bean", price: 18.5, weightOz: 13, dims: [4, 2.5, 7] },
    { sku: "CPL-BAG-MED-12", name: "Copperline Morning Medium Roast — 12oz", price: 17, weightOz: 13, dims: [4, 2.5, 7] },
    { sku: "CPL-BAG-DRK-12", name: "Copperline Midnight Dark Roast — 12oz", price: 17, weightOz: 13, dims: [4, 2.5, 7] },
    { sku: "CPL-BAG-DEC-12", name: "Copperline Water-Process Decaf — 12oz", price: 18, weightOz: 13, dims: [4, 2.5, 7] },
    { sku: "CPL-BAG-ESP-32", name: "Copperline Espresso Blend — 2lb Bulk", price: 42, weightOz: 34, dims: [6, 3.5, 10] },
    { sku: "CPL-PODS-24", name: "Copperline Single-Serve Pods (24ct)", price: 26, weightOz: 12, dims: [9, 6, 4] },
    { sku: "CPL-KIT-SAMPLER", name: "Copperline Roaster's Sampler Kit (4 × 12oz)", price: 64, weightOz: 54, dims: [9, 9, 4], isKit: true },
    { sku: "CPL-MUG-12OZ", name: "Copperline Diner Mug — 12oz", price: 16, weightOz: 14, dims: [5, 4, 4.5], isFragile: true },
  ];
  for (const t of cplItems) out.push(product("CPL", "Coffee", t));

  // HRB — coffee incl. gift kit (7)
  const hrbItems: readonly ProductTemplate[] = [
    { sku: "HRB-BAG-HSE-12", name: "Harbor House Blend — 12oz Whole Bean", price: 16.5, weightOz: 13, dims: [4, 2.5, 7] },
    { sku: "HRB-BAG-SNG-12", name: "Harbor Single Origin Huila — 12oz", price: 21, weightOz: 13, dims: [4, 2.5, 7] },
    { sku: "HRB-BAG-CLD-12", name: "Harbor Cold Brew Coarse Grind — 12oz", price: 17.5, weightOz: 13, dims: [4, 2.5, 7] },
    { sku: "HRB-INST-8", name: "Harbor Instant Sticks (8ct)", price: 14, weightOz: 3, dims: [5, 3, 2] },
    { sku: "HRB-KIT-GIFT", name: "Harbor Gift Box (2 Bags + Mug)", price: 54, weightOz: 42, dims: [11, 8, 5], isKit: true },
    { sku: "HRB-GRND-BRL", name: "Harbor Burr Grinder — Matte Black", price: 89, weightOz: 46, dims: [7, 7, 11], isFragile: true },
    { sku: "HRB-FLTR-100", name: "Harbor Paper Filters #4 (100ct)", price: 9, weightOz: 5, dims: [7, 5, 3] },
  ];
  for (const t of hrbItems) out.push(product("HRB", "Coffee", t));

  return out;
}

/* ============ people & addresses ============ */

export const FIRST_NAMES: readonly string[] = [
  "James", "Maria", "Robert", "Jennifer", "Michael", "Linda", "David", "Ashley",
  "Chris", "Amanda", "Daniel", "Melissa", "Matthew", "Stephanie", "Anthony",
  "Nicole", "Mark", "Rachel", "Steven", "Laura", "Kevin", "Megan", "Brian",
  "Hannah", "Jason", "Samantha", "Ryan", "Katie", "Eric", "Lauren", "Jacob",
  "Alyssa", "Tyler", "Brooke", "Aaron", "Vanessa", "Carlos", "Priya", "Derek",
  "Monica", "Trevor", "Jasmine", "Luis", "Erin", "Nathan", "Chloe",
];

export const LAST_NAMES: readonly string[] = [
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller",
  "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Wilson", "Anderson",
  "Thomas", "Taylor", "Moore", "Jackson", "Martin", "Lee", "Thompson", "White",
  "Harris", "Clark", "Lewis", "Walker", "Hall", "Young", "King", "Wright",
  "Scott", "Nguyen", "Green", "Baker", "Adams", "Nelson", "Rivera", "Campbell",
  "Mitchell", "Carter", "Patel", "Turner", "Ortiz", "Reyes", "Chen", "Kim",
];

export const STREET_NAMES: readonly string[] = [
  "Maple", "Oak", "Cedar", "Washington", "Lakeview", "Sunset", "Hillcrest",
  "Riverside", "Franklin", "Jefferson", "Highland", "Willow", "Magnolia",
  "Birch", "Prospect", "Sycamore", "Chestnut", "Harrison", "Monroe", "Grandview",
];

export const STREET_SUFFIXES: readonly string[] = ["St", "Ave", "Dr", "Ln", "Rd", "Ct", "Blvd", "Way"];

export interface CitySeed {
  city: string;
  state: string;
  zip: string;
  country: string;
}

export const US_CITIES: readonly CitySeed[] = [
  { city: "Austin", state: "TX", zip: "78704", country: "United States" },
  { city: "Dallas", state: "TX", zip: "75204", country: "United States" },
  { city: "Houston", state: "TX", zip: "77007", country: "United States" },
  { city: "Phoenix", state: "AZ", zip: "85016", country: "United States" },
  { city: "Denver", state: "CO", zip: "80205", country: "United States" },
  { city: "Seattle", state: "WA", zip: "98103", country: "United States" },
  { city: "Portland", state: "OR", zip: "97214", country: "United States" },
  { city: "San Diego", state: "CA", zip: "92103", country: "United States" },
  { city: "Los Angeles", state: "CA", zip: "90026", country: "United States" },
  { city: "Sacramento", state: "CA", zip: "95816", country: "United States" },
  { city: "Chicago", state: "IL", zip: "60614", country: "United States" },
  { city: "Columbus", state: "OH", zip: "43215", country: "United States" },
  { city: "Nashville", state: "TN", zip: "37206", country: "United States" },
  { city: "Atlanta", state: "GA", zip: "30307", country: "United States" },
  { city: "Charlotte", state: "NC", zip: "28205", country: "United States" },
  { city: "Raleigh", state: "NC", zip: "27601", country: "United States" },
  { city: "Tampa", state: "FL", zip: "33606", country: "United States" },
  { city: "Orlando", state: "FL", zip: "32803", country: "United States" },
  { city: "Miami", state: "FL", zip: "33130", country: "United States" },
  { city: "Philadelphia", state: "PA", zip: "19147", country: "United States" },
  { city: "Pittsburgh", state: "PA", zip: "15222", country: "United States" },
  { city: "Brooklyn", state: "NY", zip: "11215", country: "United States" },
  { city: "Buffalo", state: "NY", zip: "14222", country: "United States" },
  { city: "Boston", state: "MA", zip: "02129", country: "United States" },
  { city: "Minneapolis", state: "MN", zip: "55406", country: "United States" },
  { city: "St. Louis", state: "MO", zip: "63110", country: "United States" },
  { city: "Kansas City", state: "MO", zip: "64111", country: "United States" },
  { city: "Salt Lake City", state: "UT", zip: "84103", country: "United States" },
  { city: "Boise", state: "ID", zip: "83702", country: "United States" },
  { city: "Richmond", state: "VA", zip: "23220", country: "United States" },
];

export const INTL_CITIES: readonly CitySeed[] = [
  { city: "Toronto", state: "ON", zip: "M5V 2T6", country: "Canada" },
  { city: "Vancouver", state: "BC", zip: "V6B 1A1", country: "Canada" },
  { city: "London", state: "ENG", zip: "SW1A 1AA", country: "United Kingdom" },
];

/* ============ carriers & channels ============ */

export type Channel =
  | "Shopify"
  | "Amazon"
  | "TikTok Shop"
  | "Walmart"
  | "Wholesale"
  | "Manual";

export function storeNameFor(channel: Channel, clientName: string): string | null {
  switch (channel) {
    case "Shopify":
      return `${clientName} Storefront`;
    case "Amazon":
      return "Amazon US";
    case "TikTok Shop":
      return "TikTok Shop US";
    case "Walmart":
      return "Walmart Marketplace";
    default:
      return null;
  }
}

export function storeOrderNumberFor(channel: Channel, rng: Rng): string | null {
  switch (channel) {
    case "Shopify":
      return `SHP-${rng.digits(9)}`;
    case "Amazon":
      return `113-${rng.digits(7)}-${rng.digits(7)}`;
    case "TikTok Shop":
      return `57${rng.digits(14)}`;
    case "Walmart":
      return `200010${rng.digits(7)}`;
    default:
      return null;
  }
}

/* ============ vendors (inbound) ============ */

export const VENDORS_BY_CATEGORY: Record<"apparel" | "electronics" | "coffee", readonly string[]> = {
  apparel: ["Meridian Textile Supply", "Lakeshore Garment Works", "Crestline Knits Intl."],
  electronics: ["Shenzen Circuit Partners", "Pacific Rim Components", "Brightline OEM Group"],
  coffee: ["Finca La Aurora Importers", "Cascadia Green Bean Co.", "Port of Call Trading"],
};

/* Users, roles and passwords live in ./seed/access.ts (USER_SPECS). */
