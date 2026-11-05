export interface NavLink {
  label: string;
  href: string;
  description?: string;
}

export interface NavSection {
  heading: string;
  links: NavLink[];
}

export interface NavMenu {
  label: string;
  sections: NavSection[];
}

export const NAV_MENUS: NavMenu[] = [
  {
    label: "Fulfillment",
    sections: [
      {
        heading: "Orders",
        links: [
          { label: "Shipment Orders", href: "/orders" },
          { label: "Shipped Orders", href: "/orders?tab=shipped" },
          { label: "Return Orders", href: "/orders?tab=returns" },
        ],
      },
      {
        heading: "Operations",
        links: [
          { label: "Job Management", href: "/jobs" },
          { label: "Packing Station", href: "/jobs?tab=exceptions" },
          { label: "Shipment Plan", href: "/reports/transaction-history" },
        ],
      },
      {
        heading: "PO & Receiving",
        links: [
          { label: "Purchase Orders", href: "/receiving" },
          { label: "Receiving History", href: "/receiving?tab=history" },
          { label: "Vendors", href: "/receiving?tab=vendors" },
        ],
      },
    ],
  },
  {
    label: "Inventory",
    sections: [
      {
        heading: "Inventory",
        links: [
          { label: "Total Inventory", href: "/inventory" },
          { label: "Inventory by Location", href: "/inventory?tab=by-location" },
          { label: "Available to Promise", href: "/inventory?tab=atp" },
        ],
      },
      {
        heading: "Catalog",
        links: [
          { label: "Products", href: "/products" },
          { label: "Product Listings", href: "/products?tab=listings" },
        ],
      },
      {
        heading: "Facility",
        links: [
          { label: "Locations", href: "/locations" },
          { label: "Clients", href: "/clients" },
        ],
      },
    ],
  },
  {
    label: "Reports",
    sections: [
      {
        heading: "Reports",
        links: [
          { label: "Report Hub", href: "/reports" },
          { label: "Inventory Snapshot", href: "/reports/inventory-snapshot" },
          { label: "Transaction History", href: "/reports/transaction-history" },
        ],
      },
    ],
  },
  {
    label: "Settings",
    sections: [
      {
        heading: "Administration",
        links: [
          { label: "Users & Roles", href: "/settings" },
          { label: "Warehouses", href: "/settings?tab=warehouses" },
          { label: "Carriers", href: "/settings?tab=carriers" },
          { label: "Audit Log", href: "/settings?tab=audit" },
        ],
      },
    ],
  },
];
