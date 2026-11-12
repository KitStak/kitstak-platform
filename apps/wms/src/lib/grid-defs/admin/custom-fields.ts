/**
 * Custom Fields manager (M14, `/settings/custom-fields`): the entities with "Other Info"
 * custom fields, their labels, where they live and the permission that manages them. PURE.
 * Mirrors `CUSTOM_FIELD_PERMISSIONS` in `server/repositories/platform-custom-fields.ts`.
 */
import { CUSTOM_FIELD_ENTITIES, type CustomFieldEntity } from '@/lib/enums';

export interface CustomFieldEntityInfo {
  readonly key: CustomFieldEntity;
  readonly label: string;
  readonly noun: string;
  readonly href: string | null;
  readonly permission: string;
}

const INFO: Readonly<Record<CustomFieldEntity, Omit<CustomFieldEntityInfo, 'key'>>> = {
  shipment_order: {
    label: 'Shipment Orders',
    noun: 'Shipment order',
    href: '/orders',
    permission: 'fulfillment.shipment_orders.custom_field_management',
  },
  purchase_order: {
    label: 'Purchase Orders',
    noun: 'Purchase order',
    href: '/receiving',
    permission: 'inventory.purchase_orders.custom_field_management',
  },
  product: {
    label: 'Products',
    noun: 'Product',
    href: '/products',
    permission: 'settings.products.custom_field_management',
  },
  location: {
    label: 'Locations',
    noun: 'Location',
    href: '/locations',
    permission: 'settings.locations.custom_field_management',
  },
  work_order: {
    label: 'Work Orders',
    noun: 'Work order',
    href: '/work-orders',
    permission: 'inventory.work_orders.custom_field_management',
  },
  lp_type: {
    label: 'LP Types',
    noun: 'LP type',
    href: '/settings/lp-types',
    permission: 'settings.lp_types.custom_field_management',
  },
  shipment_package: {
    label: 'Shipment Packages',
    noun: 'Shipment package',
    href: '/settings/shipment-packages',
    permission: 'settings.shipment_packages.custom_field_management',
  },
  retailer: {
    label: 'Retailers',
    noun: 'Retailer',
    href: '/organization/retailers',
    permission: 'settings.retailers.custom_field_management',
  },
  shipment_plan: {
    label: 'Shipment Plans',
    noun: 'Shipment plan',
    href: '/shipment-plans',
    permission: 'fulfillment.shipment_plan.custom_field_management',
  },
  client: { label: 'Clients', noun: 'Client', href: '/clients', permission: 'settings.clients.edit' },
};

export const CUSTOM_FIELD_ENTITY_LIST: readonly CustomFieldEntityInfo[] = CUSTOM_FIELD_ENTITIES.map(
  (key) => ({ key, ...INFO[key] }),
);

export function customFieldEntityOf(key: string | null | undefined): CustomFieldEntityInfo | undefined {
  return CUSTOM_FIELD_ENTITY_LIST.find((e) => e.key === key);
}

/** Link to the manager filtered to one entity (used by LP Types, Shipment Packages, …). */
export const customFieldsHref = (entity: CustomFieldEntity): string =>
  `/settings/custom-fields?entity=${entity}`;

/** Any permission that lets a viewer open the manager. */
export const CUSTOM_FIELD_MANAGER_PERMISSIONS: readonly string[] = [
  ...new Set(CUSTOM_FIELD_ENTITY_LIST.map((e) => e.permission)),
  'settings.company_settings.view',
];
