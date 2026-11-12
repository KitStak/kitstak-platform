/**
 * Route-based page tab groups (BUILD_PLAN F4.6). Every tab is a real route so deep links work.
 * Pure data (relative imports only). Rendered by `<PageHeader tabs="<group>">`.
 */
import { NAV_PERMISSIONS as P } from './nav-config';

export interface PageTab {
  readonly label: string;
  readonly href: string;
  /** Any-of permission keys; empty = visible to everyone who can see the page. */
  readonly permission: readonly string[];
  readonly badge?: 'BETA' | 'NEW';
  /** Only the exact path activates this tab (index tab that prefixes its siblings). */
  readonly exact?: boolean;
  /** Extra path prefixes that also activate this tab (sibling routes outside its href). */
  readonly match?: readonly string[];
}

export type PageTabGroupKey =
  | 'orders'
  | 'shipments'
  | 'shipment-plans'
  | 'jobs'
  | 'tasks'
  | 'receiving'
  | 'inventory'
  | 'counts'
  | 'work-orders'
  | 'products'
  | 'organization'
  | 'lp'
  | 'billing'
  | 'users'
  | 'algorithms'
  | 'integrations'
  | 'monitoring'
  | 'carrier-errors'
  | 'serial'
  | 'transactions'
  | 'account';

type TabInit = Omit<PageTab, 'permission'> & { readonly permission?: string | readonly string[] };

const tab = (init: TabInit): PageTab => ({
  ...init,
  permission:
    init.permission === undefined
      ? []
      : typeof init.permission === 'string'
        ? [init.permission]
        : init.permission,
});

const CARRIER_ERRORS = '/integrations/carrier-errors';

export const PAGE_TAB_GROUPS: Readonly<Record<PageTabGroupKey, readonly PageTab[]>> = {
  orders: [
    tab({ label: 'Order Backlog', href: '/orders', permission: P.shipmentOrders, exact: true }),
    tab({ label: 'Shipped & Canceled Orders', href: '/orders/shipped', permission: P.shipmentOrders }),
    tab({ label: 'Return Orders', href: '/orders/returns', permission: P.returnOrders }),
  ],
  shipments: [
    tab({
      label: 'Carrier Shipment Details',
      href: '/shipments',
      permission: P.carrierShipments,
      exact: true,
    }),
    tab({ label: 'End Of The Day', href: '/shipments/end-of-day', permission: P.endOfDay }),
  ],
  'shipment-plans': [
    tab({ label: 'Shipment Plan', href: '/shipment-plans', permission: P.shipmentPlan, exact: true }),
    tab({ label: 'Shipment Plan Orders', href: '/shipment-plans/orders', permission: P.shipmentPlan }),
    tab({ label: 'Shipment Plan LPs', href: '/shipment-plans/lps', permission: P.shipmentPlan }),
  ],
  jobs: [
    tab({ label: 'Wave Rules', href: '/jobs/wave-rules', permission: P.waveRules }),
    tab({ label: 'Job Management', href: '/jobs', permission: P.jobs, exact: true }),
    tab({
      label: 'Allocation Exceptions',
      href: '/jobs/allocation-exceptions',
      permission: P.waveExceptions,
    }),
    tab({ label: 'Wave Log Report', href: '/jobs/wave-log', permission: P.waveLog }),
    tab({ label: 'Shortage Report', href: '/jobs/shortage', permission: P.shortage }),
    tab({ label: 'Job Types', href: '/settings/job-types', permission: P.jobTypes }),
  ],
  tasks: [
    tab({ label: 'Order Operations', href: '/tasks/order-operations', permission: P.taskDetails }),
    tab({ label: 'Count', href: '/tasks/count', permission: P.taskDetails }),
    tab({ label: 'Replenishment', href: '/tasks/replenishment', permission: P.taskDetails }),
  ],
  receiving: [
    tab({ label: 'Purchase Order', href: '/receiving', permission: P.purchaseOrders, exact: true }),
    tab({ label: 'Vendors', href: '/receiving/vendors', permission: P.vendors }),
    tab({ label: 'Receiving History', href: '/receiving/history', permission: P.receivingHistory }),
    tab({ label: 'Putaway', href: '/receiving/putaway', permission: P.purchaseOrders }),
  ],
  inventory: [
    tab({ label: 'Total Inventory', href: '/inventory', permission: P.totalInventory, exact: true }),
    tab({
      label: 'Inventory by Location',
      href: '/inventory/by-location',
      permission: P.inventoryByLocation,
    }),
    tab({ label: 'Available To Promise', href: '/inventory/atp', permission: P.atp }),
    tab({ label: 'Kit Inventory', href: '/inventory/kits', permission: P.kitInventory }),
    tab({
      label: 'Kit Component Inventory Availability',
      href: '/inventory/kit-components',
      permission: P.kitComponents,
    }),
  ],
  counts: [
    tab({ label: 'Count Plan', href: '/counts', permission: P.countPlans, exact: true }),
    tab({ label: 'Location Details', href: '/counts/locations', permission: P.countLocations }),
    tab({ label: 'SKU Details', href: '/counts/skus', permission: P.countSkus }),
  ],
  'work-orders': [tab({ label: 'Work Orders', href: '/work-orders', permission: P.workOrders })],
  products: [
    tab({ label: 'Products', href: '/products', permission: P.products, exact: true }),
    tab({ label: 'Product Listings', href: '/products/listings', permission: P.productListings }),
  ],
  organization: [
    tab({ label: 'Client', href: '/clients', permission: P.clients }),
    tab({ label: 'Customer', href: '/organization/customers', permission: P.customers }),
    tab({ label: 'Vendors', href: '/organization/vendors', permission: P.vendors }),
    tab({ label: 'Retailers', href: '/organization/retailers', permission: P.retailers }),
  ],
  lp: [
    tab({ label: 'LP Types', href: '/settings/lp-types', permission: P.lpTypes }),
    tab({ label: 'LP Numbers', href: '/settings/lp-numbers', permission: P.lpNumbers }),
  ],
  billing: [
    tab({ label: '3PL Billing', href: '/billing', permission: P.billing, exact: true }),
    tab({ label: 'Billing Report', href: '/billing/reports', permission: P.billingReport }),
    tab({ label: 'VAS Operations', href: '/billing/vas', permission: P.vas }),
  ],
  users: [
    tab({ label: 'Users', href: '/settings/users', permission: P.users }),
    tab({ label: 'Roles', href: '/settings/roles', permission: P.roles }),
  ],
  algorithms: [
    tab({ label: 'Putaway Algorithm', href: '/automation/algorithms/putaway', permission: P.algorithms }),
    tab({
      label: 'Allocation Algorithm',
      href: '/automation/algorithms/allocation',
      permission: P.algorithms,
    }),
  ],
  integrations: [
    tab({
      label: 'Plugin Integrations',
      href: '/integrations/channels',
      permission: P.integrationSetup,
      match: ['/integrations/carriers'],
    }),
    tab({
      label: 'Channel Logs',
      href: '/integrations/logs/methods',
      permission: P.integrationLogs,
      match: ['/integrations/logs'],
    }),
  ],
  monitoring: [
    tab({
      label: 'Channel Health Overview',
      href: '/integrations/monitoring',
      permission: P.integrationMonitoring,
      exact: true,
    }),
    tab({
      label: 'Channel Setup Details',
      href: '/integrations/monitoring/setup',
      permission: P.integrationMonitoring,
    }),
    tab({
      label: 'Items For Review',
      href: '/integrations/monitoring/missing-orders',
      permission: P.integrationMonitoring,
      match: [
        '/integrations/monitoring/recent-errors',
        '/integrations/monitoring/workflow-blocked',
        '/integrations/monitoring/listing-exceptions',
      ],
    }),
  ],
  'carrier-errors': [
    tab({
      label: 'Label Generation',
      href: `${CARRIER_ERRORS}/label-generation`,
      permission: P.carrierMonitoring,
    }),
    tab({ label: 'Rate Call', href: `${CARRIER_ERRORS}/rate-call`, permission: P.carrierMonitoring }),
    tab({
      label: 'Void/Cancel Label',
      href: `${CARRIER_ERRORS}/void-label`,
      permission: P.carrierMonitoring,
    }),
  ],
  serial: [
    tab({ label: 'Tracking', href: '/reports/serial-numbers', permission: P.serialNumbers, exact: true }),
    tab({
      label: 'Serial Number Shipment History',
      href: '/reports/serial-numbers/shipment-history',
      permission: P.serialNumbers,
    }),
    tab({
      label: 'Serial Number Receiving History',
      href: '/reports/serial-numbers/receiving-history',
      permission: P.serialNumbers,
    }),
  ],
  transactions: [
    tab({
      label: 'Transaction History',
      href: '/reports/transaction-history',
      permission: P.transactionHistory,
      exact: true,
    }),
    tab({
      label: 'Serial Number Transaction History',
      href: '/reports/transaction-history/serial',
      permission: P.serialTransactions,
    }),
  ],
  account: [
    tab({ label: 'My Profile', href: '/account/profile', permission: P.myProfile }),
    tab({ label: 'Change Password', href: '/account/password', permission: P.changePassword }),
    tab({ label: 'Preferences', href: '/account/preferences' }),
  ],
};

export const PAGE_TAB_GROUP_KEYS = Object.keys(PAGE_TAB_GROUPS) as readonly PageTabGroupKey[];

/** The tab group whose tabs contain `pathname` exactly (first match), if any. */
export function tabGroupForPath(pathname: string): PageTabGroupKey | null {
  return PAGE_TAB_GROUP_KEYS.find((key) => PAGE_TAB_GROUPS[key].some((t) => t.href === pathname)) ?? null;
}
