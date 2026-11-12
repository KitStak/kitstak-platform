/**
 * Complete navigation map (BUILD_PLAN F4.7): every Logiwa iO menu item mapped to a KitStaks
 * route and its owning module. Drives the mega-menus, mobile drawer, breadcrumbs, the
 * "Pages" group of global search and the dead-click audit.
 *
 * PURE DATA — no imports, so the server search walker, the client shell and Playwright
 * (plain `require`) can all load it. Only static routes live here; detail/create routes are
 * in `route-registry.ts`.
 */

export type ModuleOwner =
  | 'M01'
  | 'M02'
  | 'M03'
  | 'M04'
  | 'M05'
  | 'M06'
  | 'M07'
  | 'M08'
  | 'M09'
  | 'M10'
  | 'M11'
  | 'M12'
  | 'M13'
  | 'M14'
  | 'Foundation';

/** Icon names resolved to lucide components by `components/layout/nav-icons.tsx`. */
export type NavIconName =
  | 'dashboard'
  | 'outbound'
  | 'task-management'
  | 'shipment'
  | 'inbound'
  | 'inventory'
  | 'count'
  | 'automation'
  | 'integration'
  | 'logs'
  | 'monitoring'
  | 'carrier'
  | 'orders'
  | 'receiving'
  | 'efficiency'
  | 'labor'
  | 'operational'
  | 'master-data'
  | 'configs'
  | 'client-setup'
  | 'users'
  | 'reports'
  | 'settings'
  | 'profile'
  | 'password'
  | 'preferences'
  | 'company'
  | 'apps'
  | 'notifications';

export type NavBadge = 'BETA' | 'NEW';

export interface NavItem {
  readonly label: string;
  readonly href: string;
  /** Any-of permission keys; empty = every signed-in user. */
  readonly permission: readonly string[];
  readonly owner: ModuleOwner;
  readonly icon?: NavIconName;
  readonly badge?: NavBadge;
  /** Extra search terms for the Pages group of global search. */
  readonly aliases?: readonly string[];
  /** Key of the add-on app (Settings → Apps) that must be active for the item to show. */
  readonly app?: string;
}

export interface NavColumn {
  readonly heading: string;
  readonly icon: NavIconName;
  readonly items: readonly NavItem[];
}

export interface NavMenu {
  readonly key: string;
  readonly label: string;
  readonly columns: readonly NavColumn[];
  /** Optional "see all" link rendered under the columns. */
  readonly footer?: NavItem;
}

type ItemInit = Omit<NavItem, 'permission'> & { readonly permission?: string | readonly string[] };

const item = (init: ItemInit): NavItem => ({
  ...init,
  permission:
    init.permission === undefined
      ? []
      : typeof init.permission === 'string'
        ? [init.permission]
        : init.permission,
});

/* ------------------------------------------------------------------ keys */

const P = {
  shipmentOrders: 'fulfillment.shipment_orders.view',
  carrierShipments: 'fulfillment.carrier_shipment_details.view',
  endOfDay: 'fulfillment.end_of_day.view',
  packingStation: 'fulfillment.packing_station.view',
  jobs: 'fulfillment.job_management.view',
  taskDetails: 'fulfillment.task_details.view',
  shipmentHistory: 'fulfillment.shipment_history.view',
  shipmentPlan: 'fulfillment.shipment_plan.view',
  purchaseOrders: 'inventory.purchase_orders.view',
  receivingHistory: 'inventory.receiving_history.view',
  returnStation: 'inventory.return_station.view',
  returnOrders: 'inventory.return_orders.view',
  workOrders: 'inventory.work_orders.view',
  totalInventory: 'inventory.total_inventory.view',
  inventoryByLocation: 'inventory.inventory_by_location.view',
  atp: 'inventory.atp.view',
  countPlans: 'inventory.count_plans.view',
  countLocations: 'inventory.count_location_details.view',
  countSkus: 'inventory.count_sku_details.view',
  algorithms: 'automation.algorithms.view',
  workflows: 'automation.workflows.view',
  rateShopping: 'automation.rate_shopping.view',
  waveRules: 'automation.wave_rules.view',
  integrationSetup: [
    'integrations.integrations.create_setup',
    'integrations.integrations.edit_setup',
    'integrations.integrations.delete_setup',
  ],
  integrationLogs: 'integrations.integration_logs.view',
  integrationMonitoring: 'integrations.integration_monitoring.view',
  carrierMonitoring: 'integrations.carrier_monitoring.view',
  shortage: 'reports.shortage_report.view',
  channelSales: 'reports.channel_sales_report.view',
  kitInventory: 'reports.kit_inventory.view',
  replenishmentReport: 'reports.dynamic_replenishment_report.view',
  inventorySnapshot: 'reports.inventory_snapshot_report.view',
  kitComponents: 'reports.kit_component_availability_report.view',
  serialNumbers: 'reports.serial_number_tracking_report.view',
  orderInventory: 'reports.order_inventory_report.view',
  exportHistory: 'reports.excel_export_history.view',
  changeLog: 'reports.change_log.view',
  transactionHistory: 'reports.transaction_history.view',
  missingLog: 'reports.inventory_missing_log.view',
  serialTransactions: 'reports.serial_number_transaction_history.view',
  waveExceptions: 'reports.wave_exceptions.view',
  waveLog: 'reports.wave_log_report.view',
  poReceiving: 'reports.po_receiving_report.view',
  userPerformance: 'reports.user_performance_report.view',
  laborAnalytics: 'analytics.labor_analytics.view',
  operationalAnalytics: 'analytics.operational_analytics.view',
  retailers: 'settings.retailers.view',
  products: 'settings.products.view',
  productListings: 'settings.product_listing.view',
  locations: 'settings.locations.view',
  vendors: 'settings.vendors.view',
  customers: 'settings.customers.view',
  warehouse: 'settings.warehouse.view',
  mobileCarts: 'settings.mobile_carts.view',
  lpTypes: 'settings.lp_types.view',
  lpNumbers: 'settings.lp_numbers.view',
  shipmentPackages: 'settings.shipment_packages.view',
  printouts: 'settings.printouts_labels.view',
  dataSetup: 'settings.data_setup.view',
  jobTypes: 'settings.job_types.view',
  screenConfiguration: 'settings.screen_configuration.view',
  clients: 'settings.clients.view',
  billing: 'settings.billing.view',
  billingReport: 'settings.billing_report.view',
  vas: 'settings.vas_operations.view',
  users: 'settings.users.view',
  roles: 'settings.roles.view',
  changePassword: 'settings.change_password.view',
  myProfile: 'settings.my_profile.view',
  companySettings: 'settings.company_settings.view',
  apps: 'settings.add_ons.view',
} as const;

/** Exposed for tests and page-tabs (single source for permission keys). */
export const NAV_PERMISSIONS = P;

const ANY_REPORT: readonly string[] = [
  P.channelSales,
  P.shortage,
  P.kitInventory,
  P.kitComponents,
  P.serialNumbers,
  P.orderInventory,
  P.replenishmentReport,
  P.inventorySnapshot,
  P.changeLog,
  P.transactionHistory,
  P.missingLog,
  P.serialTransactions,
  P.waveExceptions,
  P.waveLog,
  P.exportHistory,
  P.poReceiving,
  P.userPerformance,
];

/* ------------------------------------------------------------------ items */

export const DASHBOARD_ITEM: NavItem = item({
  label: 'Dashboard',
  href: '/dashboard',
  owner: 'M13',
  icon: 'dashboard',
  aliases: ['home', 'overview'],
});

const shipmentHistory = item({
  label: 'Shipment History',
  href: '/shipments/history',
  permission: P.shipmentHistory,
  owner: 'M02',
});
const atp = item({
  label: 'Available To Promise (ATP)',
  href: '/inventory/atp',
  permission: P.atp,
  owner: 'M06',
  aliases: ['atp'],
});
const receivingHistory = item({
  label: 'Receiving History',
  href: '/receiving/history',
  permission: P.receivingHistory,
  owner: 'M05',
  aliases: ['receipts'],
});

export const NAV_MENUS: readonly NavMenu[] = [
  {
    key: 'fulfillment',
    label: 'Fulfillment',
    columns: [
      {
        heading: 'Outbound',
        icon: 'outbound',
        items: [
          item({
            label: 'Shipment Orders',
            href: '/orders',
            permission: P.shipmentOrders,
            owner: 'M01',
            aliases: ['orders', 'sales orders', 'backlog'],
          }),
          item({
            label: 'Shipped & Canceled Orders',
            href: '/orders/shipped',
            permission: P.shipmentOrders,
            owner: 'M01',
            aliases: ['shipped orders', 'canceled orders'],
          }),
          item({
            label: 'Return Orders',
            href: '/orders/returns',
            permission: P.returnOrders,
            owner: 'M04',
            aliases: ['returns', 'rma'],
          }),
          item({
            label: 'Carrier Shipment Details',
            href: '/shipments',
            permission: P.carrierShipments,
            owner: 'M02',
            aliases: ['labels', 'tracking'],
          }),
          item({
            label: 'End Of The Day',
            href: '/shipments/end-of-day',
            permission: P.endOfDay,
            owner: 'M02',
            aliases: ['eod', 'manifest'],
          }),
          item({
            label: 'Packing Station',
            href: '/packing-station',
            permission: P.packingStation,
            owner: 'M04',
            aliases: ['pack'],
          }),
          // One home for returns: Return Station sits with Return Orders and Packing Station (M04).
          item({
            label: 'Return Station',
            href: '/return-station',
            permission: P.returnStation,
            owner: 'M04',
            aliases: ['rma', 'receive return'],
          }),
        ],
      },
      {
        heading: 'Task Management',
        icon: 'task-management',
        items: [
          item({
            label: 'Job Management',
            href: '/jobs',
            permission: P.jobs,
            owner: 'M03',
            aliases: ['jobs', 'waves', 'picking'],
          }),
          item({
            label: 'Order Operations Task Details',
            href: '/tasks/order-operations',
            permission: P.taskDetails,
            owner: 'M03',
            aliases: ['tasks'],
          }),
          item({
            label: 'Count Task Details',
            href: '/tasks/count',
            permission: P.taskDetails,
            owner: 'M03',
          }),
          item({
            label: 'Replenishment Task Details',
            href: '/tasks/replenishment',
            permission: P.taskDetails,
            owner: 'M03',
          }),
        ],
      },
      {
        heading: 'Shipment',
        icon: 'shipment',
        items: [
          shipmentHistory,
          item({
            label: 'Shipment Plan',
            href: '/shipment-plans',
            permission: P.shipmentPlan,
            owner: 'M02',
            aliases: ['shipment plan', 'loading', 'bol'],
          }),
        ],
      },
    ],
  },
  {
    key: 'inventory',
    label: 'Inventory',
    columns: [
      {
        heading: 'Inbound',
        icon: 'inbound',
        items: [
          item({
            label: 'Purchase Orders',
            href: '/receiving',
            permission: P.purchaseOrders,
            owner: 'M05',
            aliases: ['po', 'receiving', 'asn'],
          }),
          receivingHistory,
          item({
            label: 'Work Orders',
            href: '/work-orders',
            permission: P.workOrders,
            owner: 'M08',
            aliases: ['kitting', 'assembly'],
          }),
        ],
      },
      {
        heading: 'Inventory',
        icon: 'inventory',
        items: [
          item({
            label: 'Total Inventory',
            href: '/inventory',
            permission: P.totalInventory,
            owner: 'M06',
            aliases: ['stock', 'on hand'],
          }),
          item({
            label: 'Inventory by Location',
            href: '/inventory/by-location',
            permission: P.inventoryByLocation,
            owner: 'M06',
            aliases: ['bins', 'lp'],
          }),
          atp,
          // Kit pages live in the Inventory tab strip, so they belong to the Inventory menu (Reports keeps shortcuts).
          item({
            label: 'Kit Inventory',
            href: '/inventory/kits',
            permission: P.kitInventory,
            owner: 'M08',
            aliases: ['kit inventory report', 'kits'],
          }),
          item({
            label: 'Kit Component Inventory',
            href: '/inventory/kit-components',
            permission: P.kitComponents,
            owner: 'M08',
            aliases: ['kit component inventory availability report', 'components'],
          }),
        ],
      },
      {
        heading: 'Count Operations',
        icon: 'count',
        items: [
          item({
            label: 'Count Plan',
            href: '/counts',
            permission: P.countPlans,
            owner: 'M07',
            aliases: ['cycle count'],
          }),
          item({
            label: 'Count Location Details',
            href: '/counts/locations',
            permission: P.countLocations,
            owner: 'M07',
          }),
          item({ label: 'Count SKU Details', href: '/counts/skus', permission: P.countSkus, owner: 'M07' }),
        ],
      },
    ],
  },
  {
    key: 'automation',
    label: 'Automation',
    columns: [
      {
        heading: 'Workflows & Algorithms',
        icon: 'automation',
        items: [
          item({
            label: 'Algorithms',
            href: '/automation/algorithms',
            permission: P.algorithms,
            owner: 'M12',
            aliases: ['putaway', 'allocation'],
          }),
          item({
            label: 'Workflows',
            href: '/automation/workflows',
            permission: P.workflows,
            owner: 'M12',
            aliases: ['rules'],
          }),
          item({
            label: 'Rate Shopping',
            href: '/automation/rate-shopping',
            permission: P.rateShopping,
            owner: 'M12',
            aliases: ['rates'],
          }),
          item({
            label: 'Wave Rules',
            href: '/jobs/wave-rules',
            permission: P.waveRules,
            owner: 'M03',
            aliases: ['waves'],
          }),
        ],
      },
    ],
  },
  {
    key: 'integrations',
    label: 'Integrations',
    columns: [
      {
        heading: 'Plugin Integrations',
        icon: 'integration',
        items: [
          item({
            label: 'Channel Integrations',
            href: '/integrations/channels',
            permission: P.integrationSetup,
            owner: 'M12',
            aliases: ['shopify', 'amazon', 'channels'],
          }),
          item({
            label: 'Carrier Integrations',
            href: '/integrations/carriers',
            permission: P.integrationSetup,
            owner: 'M12',
            aliases: ['ups', 'fedex', 'usps', 'carriers'],
          }),
        ],
      },
      {
        heading: 'Channel Logs',
        icon: 'logs',
        items: [
          item({
            label: 'Channel Methods',
            href: '/integrations/logs/methods',
            permission: P.integrationLogs,
            owner: 'M12',
          }),
          item({
            label: 'Channel History',
            href: '/integrations/logs/history',
            permission: P.integrationLogs,
            owner: 'M12',
            aliases: ['integration log'],
          }),
          item({
            label: 'Orders and Shipments',
            href: '/integrations/logs/orders',
            permission: P.integrationLogs,
            owner: 'M12',
          }),
          item({
            label: 'Products and Inventory',
            href: '/integrations/logs/products',
            permission: P.integrationLogs,
            owner: 'M12',
          }),
        ],
      },
      {
        heading: 'Channel Monitoring',
        icon: 'monitoring',
        items: [
          item({
            label: 'Channel Health Overview',
            href: '/integrations/monitoring',
            permission: P.integrationMonitoring,
            owner: 'M12',
          }),
          item({
            label: 'Channel Setup Details',
            href: '/integrations/monitoring/setup',
            permission: P.integrationMonitoring,
            owner: 'M12',
          }),
          item({
            label: 'Missing Shipment Orders',
            href: '/integrations/monitoring/missing-orders',
            permission: P.integrationMonitoring,
            owner: 'M12',
          }),
          item({
            label: 'Recent Errors',
            href: '/integrations/monitoring/recent-errors',
            permission: P.integrationMonitoring,
            owner: 'M12',
          }),
          item({
            label: 'Workflow Blocked Shipment Orders',
            href: '/integrations/monitoring/workflow-blocked',
            permission: P.integrationMonitoring,
            owner: 'M12',
          }),
          item({
            label: 'Product Listing Exceptions',
            href: '/integrations/monitoring/listing-exceptions',
            permission: P.integrationMonitoring,
            owner: 'M12',
          }),
        ],
      },
      {
        heading: 'Carrier Monitoring',
        icon: 'carrier',
        items: [
          item({
            label: 'Carrier Errors',
            href: '/integrations/carrier-errors/label-generation',
            permission: P.carrierMonitoring,
            owner: 'M12',
            aliases: ['label errors'],
          }),
        ],
      },
    ],
  },
  {
    key: 'reports',
    label: 'Reports',
    columns: [
      {
        heading: 'Orders',
        icon: 'orders',
        items: [
          item({
            label: 'Channel Sales Report',
            href: '/reports/channel-sales',
            permission: P.channelSales,
            owner: 'M13',
          }),
          shipmentHistory,
          item({ label: 'Shortage Report', href: '/jobs/shortage', permission: P.shortage, owner: 'M03' }),
          item({
            label: 'Order Line Progress',
            href: '/reports/order-lines',
            permission: P.shipmentOrders,
            owner: 'M13',
            aliases: ['order lines', 'picked', 'packed', 'line progress'],
          }),
        ],
      },
      {
        heading: 'Inventory',
        icon: 'inventory',
        items: [
          atp,
          item({
            label: 'Kit Inventory Report',
            href: '/inventory/kits',
            permission: P.kitInventory,
            owner: 'M08',
          }),
          item({
            label: 'Kit Component Inventory Availability Report',
            href: '/inventory/kit-components',
            permission: P.kitComponents,
            owner: 'M08',
          }),
          item({
            label: 'Serial Number Report',
            href: '/reports/serial-numbers',
            permission: P.serialNumbers,
            owner: 'M13',
            aliases: ['serials'],
          }),
          item({
            label: 'Order Inventory',
            href: '/reports/order-inventory',
            permission: P.orderInventory,
            owner: 'M13',
          }),
          item({
            label: 'Dynamic Replenishment Report',
            href: '/reports/replenishment',
            permission: P.replenishmentReport,
            owner: 'M13',
          }),
          item({
            label: 'Inventory Snapshot Report',
            href: '/reports/inventory-snapshot',
            permission: P.inventorySnapshot,
            owner: 'M13',
          }),
        ],
      },
      {
        heading: 'Inventory Analysis',
        icon: 'monitoring',
        items: [
          item({
            label: 'Inventory Aging Report',
            href: '/reports/inventory-aging',
            permission: 'inventory.total_inventory.view',
            owner: 'M13',
            aliases: ['aging', 'slow movers', 'stock age'],
          }),
          item({
            label: 'Location Utilization Report',
            href: '/reports/location-utilization',
            permission: 'settings.locations.view',
            owner: 'M13',
            aliases: ['capacity', 'utilization', 'space'],
          }),
        ],
      },
      {
        heading: 'Logs',
        icon: 'logs',
        items: [
          item({
            label: 'Change Log',
            href: '/reports/change-log',
            permission: P.changeLog,
            owner: 'M13',
            aliases: ['audit', 'history'],
          }),
          item({
            label: 'Transaction History',
            href: '/reports/transaction-history',
            permission: P.transactionHistory,
            owner: 'M13',
            aliases: ['ledger', 'movements'],
          }),
          item({
            label: 'Integration Log',
            href: '/integrations/logs/history',
            permission: P.integrationLogs,
            owner: 'M12',
          }),
          item({
            label: 'Missing Log',
            href: '/reports/missing-log',
            permission: P.missingLog,
            owner: 'M13',
          }),
          item({
            label: 'Serial Number Transaction History',
            href: '/reports/transaction-history/serial',
            permission: P.serialTransactions,
            owner: 'M13',
          }),
          item({
            label: 'Allocation Exceptions',
            href: '/jobs/allocation-exceptions',
            permission: P.waveExceptions,
            owner: 'M03',
            aliases: ['wave exceptions'],
          }),
          item({ label: 'Wave Log Report', href: '/jobs/wave-log', permission: P.waveLog, owner: 'M03' }),
          item({
            label: 'Excel Export History',
            href: '/reports/export-history',
            permission: P.exportHistory,
            owner: 'M13',
            aliases: ['exports', 'downloads'],
          }),
        ],
      },
      {
        heading: 'Receiving',
        icon: 'receiving',
        items: [
          item({
            label: 'PO Receiving Report',
            href: '/reports/po-receiving',
            permission: P.poReceiving,
            owner: 'M13',
            aliases: ['partial receipt'],
          }),
          receivingHistory,
        ],
      },
      {
        heading: 'Warehouse Efficiency',
        icon: 'efficiency',
        items: [
          item({
            label: 'User Performance Report',
            href: '/reports/user-performance',
            permission: P.userPerformance,
            owner: 'M13',
            aliases: ['productivity'],
          }),
        ],
      },
    ],
    footer: item({
      label: 'Report Hub',
      href: '/reports',
      permission: ANY_REPORT,
      owner: 'M13',
      icon: 'reports',
      aliases: ['all reports'],
    }),
  },
  {
    key: 'analytics',
    label: 'Analytics',
    columns: [
      {
        heading: 'Labor Analytics',
        icon: 'labor',
        items: [
          item({
            label: 'Average Task Analysis',
            href: '/analytics/labor/average-task',
            permission: P.laborAnalytics,
            owner: 'M13',
            app: 'labor-analytics',
          }),
          item({
            label: 'Associate Task Analysis',
            href: '/analytics/labor/associate-task',
            permission: P.laborAnalytics,
            owner: 'M13',
            app: 'labor-analytics',
          }),
          item({
            label: 'Performance Quadrant Analysis',
            href: '/analytics/labor/performance-quadrant',
            permission: P.laborAnalytics,
            owner: 'M13',
            app: 'labor-analytics',
          }),
          item({
            label: 'Associate Analysis',
            href: '/analytics/labor/associate',
            permission: P.laborAnalytics,
            owner: 'M13',
            app: 'labor-analytics',
          }),
          item({
            label: 'Receiving Performance Analysis',
            href: '/analytics/labor/receiving-performance',
            permission: P.laborAnalytics,
            owner: 'M13',
            app: 'labor-analytics',
          }),
        ],
      },
      {
        heading: 'Operational Analytics',
        icon: 'operational',
        items: [
          item({
            label: 'Inbound & Inventory Dashboard',
            href: '/analytics/operational/inbound-inventory',
            permission: P.operationalAnalytics,
            owner: 'M13',
            app: 'operational-analytics',
          }),
          item({
            label: 'Fulfillment Dashboard',
            href: '/analytics/operational/fulfillment',
            permission: P.operationalAnalytics,
            owner: 'M13',
            app: 'operational-analytics',
          }),
          item({
            label: 'Management Dashboard',
            href: '/analytics/operational/management',
            permission: P.operationalAnalytics,
            owner: 'M13',
            app: 'operational-analytics',
          }),
          item({
            label: 'Productivity Dashboard',
            href: '/analytics/operational/productivity',
            permission: P.operationalAnalytics,
            owner: 'M13',
            app: 'operational-analytics',
          }),
        ],
      },
    ],
  },
  {
    key: 'settings',
    label: 'Settings',
    columns: [
      {
        heading: 'Master Data',
        icon: 'master-data',
        items: [
          item({
            label: 'Products',
            href: '/products',
            permission: P.products,
            owner: 'M09',
            aliases: ['sku', 'items', 'catalog'],
          }),
          item({
            label: 'Product Listings',
            href: '/products/listings',
            permission: P.productListings,
            owner: 'M09',
            aliases: ['listings'],
          }),
          item({
            label: 'Locations',
            href: '/locations',
            permission: P.locations,
            owner: 'M10',
            aliases: ['bins'],
          }),
          item({
            label: 'Vendors',
            href: '/organization/vendors',
            permission: P.vendors,
            owner: 'M05',
            aliases: ['suppliers'],
          }),
          item({
            label: 'Customers',
            href: '/organization/customers',
            permission: P.customers,
            owner: 'M11',
          }),
          item({
            label: 'Retailers',
            href: '/organization/retailers',
            permission: P.retailers,
            owner: 'M11',
          }),
        ],
      },
      {
        heading: 'Configuration',
        icon: 'configs',
        items: [
          item({
            label: 'Warehouse',
            href: '/settings/warehouses',
            permission: P.warehouse,
            owner: 'M10',
            aliases: ['warehouses', 'facility'],
          }),
          item({
            label: 'Mobile Carts',
            href: '/settings/mobile-carts',
            permission: P.mobileCarts,
            owner: 'M10',
            aliases: ['carts'],
          }),
          item({
            label: 'LP Types',
            href: '/settings/lp-types',
            permission: P.lpTypes,
            owner: 'M10',
            aliases: ['license plates', 'pallets'],
          }),
          item({ label: 'LP Numbers', href: '/settings/lp-numbers', permission: P.lpNumbers, owner: 'M10' }),
          item({
            label: 'Shipment Packages',
            href: '/settings/shipment-packages',
            permission: P.shipmentPackages,
            owner: 'M10',
            aliases: ['boxes', 'cartons'],
          }),
          item({
            label: 'Printouts & Labels',
            href: '/settings/printouts',
            permission: P.printouts,
            owner: 'M14',
            aliases: ['templates', 'labels'],
          }),
          item({
            label: 'Data Setup',
            href: '/settings/data-setup/code-generation',
            permission: P.dataSetup,
            owner: 'M14',
            aliases: ['lookups', 'code generation'],
          }),
          item({ label: 'Job Types', href: '/settings/job-types', permission: P.jobTypes, owner: 'M03' }),
          item({
            label: 'Screen Configuration',
            href: '/settings/screen-configuration',
            permission: P.screenConfiguration,
            owner: 'M14',
          }),
        ],
      },
      {
        heading: 'Client Setup',
        icon: 'client-setup',
        items: [
          item({
            label: 'Clients',
            href: '/clients',
            permission: P.clients,
            owner: 'M11',
            aliases: ['depositors', '3pl clients'],
          }),
          item({
            label: '3PL Billing',
            href: '/billing',
            permission: P.billing,
            owner: 'M11',
            aliases: ['invoices', 'billing'],
          }),
          item({
            label: 'Billing Report',
            href: '/billing/reports',
            permission: P.billingReport,
            owner: 'M11',
          }),
          item({
            label: 'VAS Operations',
            href: '/billing/vas',
            permission: P.vas,
            owner: 'M11',
            aliases: ['value added services'],
          }),
        ],
      },
      {
        heading: 'Company',
        icon: 'company',
        items: [
          item({
            label: 'Company Settings',
            href: '/settings/company',
            permission: P.companySettings,
            owner: 'M14',
            aliases: ['company', 'security', 'email delivery'],
          }),
          item({
            label: 'Apps',
            href: '/settings/apps',
            permission: P.apps,
            owner: 'M14',
            aliases: ['add-ons', 'marketplace'],
          }),
        ],
      },
      {
        heading: 'Users',
        icon: 'users',
        items: [
          item({ label: 'Users', href: '/settings/users', permission: P.users, owner: 'M14' }),
          item({
            label: 'Roles',
            href: '/settings/roles',
            permission: P.roles,
            owner: 'M14',
            aliases: ['permissions'],
          }),
          item({
            label: 'Audit Log',
            href: '/settings/audit',
            permission: P.users,
            owner: 'M14',
            aliases: ['security log'],
          }),
        ],
      },
    ],
    footer: item({
      label: 'Settings overview',
      href: '/settings',
      permission: [P.users, P.warehouse, P.clients, P.products],
      owner: 'M14',
      icon: 'settings',
    }),
  },
];

/** User menu (Logiwa parity + Preferences). Sign out actions are rendered by the shell. */
export const USER_MENU_ITEMS: readonly NavItem[] = [
  item({
    label: 'My Profile',
    href: '/account/profile',
    permission: P.myProfile,
    owner: 'M14',
    icon: 'profile',
  }),
  item({
    label: 'Change Password',
    href: '/account/password',
    permission: P.changePassword,
    owner: 'M14',
    icon: 'password',
  }),
  item({
    label: 'Preferences',
    href: '/account/preferences',
    owner: 'M14',
    icon: 'preferences',
    aliases: ['date format', 'theme'],
  }),
  item({
    label: 'Company Settings',
    href: '/settings/company',
    permission: P.companySettings,
    owner: 'M14',
    icon: 'company',
  }),
  item({
    label: 'Apps',
    href: '/settings/apps',
    permission: P.apps,
    owner: 'M14',
    icon: 'apps',
    aliases: ['add-ons', 'marketplace'],
  }),
];

export const HEADER_ITEMS: readonly NavItem[] = [
  item({
    label: 'Notifications',
    href: '/notifications',
    owner: 'Foundation',
    icon: 'notifications',
    aliases: ['alerts', 'inbox'],
  }),
];
