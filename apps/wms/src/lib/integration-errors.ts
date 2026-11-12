/**
 * Channel order-download error catalog (BUILD_PLAN F4.1; spec 06 §14 "Last Error Code").
 * Each code has a title, plain-language explanation, recommended action and a guide link,
 * shown in the Missing Shipment Orders drawer "Error Details" block.
 */

export interface IntegrationErrorInfo {
  readonly code: string;
  readonly title: string;
  readonly explanation: string;
  readonly recommendedAction: string;
  readonly guideHref: string;
}

const GUIDE_BASE = '/help/integrations/errors';

const entry = (
  code: string,
  slug: string,
  title: string,
  explanation: string,
  recommendedAction: string,
): IntegrationErrorInfo => ({
  code,
  title,
  explanation,
  recommendedAction,
  guideHref: `${GUIDE_BASE}/${slug}`,
});

export const INTEGRATION_ERRORS: readonly IntegrationErrorInfo[] = Object.freeze([
  entry(
    'All products are Digital',
    'all-products-digital',
    'The order only contains digital products',
    'Every line on this store order is a digital or non-shippable product, so there is nothing for the warehouse to fulfill.',
    'No action is needed if the order is digital only. If it should ship, mark the products as physical (requires shipping) in your store and download the order again.',
  ),
  entry(
    'Fulfillment Orders not found in the Order',
    'fulfillment-orders-missing',
    'The store did not return any fulfillment orders',
    'The channel sent the order without fulfillment orders, which KitStak needs to know what to ship and from where.',
    'Open the order in your store and confirm it is unfulfilled and assigned to a location, then retry the download.',
  ),
  entry(
    'Fulfillment Orders not found in the specified location',
    'fulfillment-location-mismatch',
    'No fulfillment order is assigned to a linked location',
    "The order's fulfillment orders belong to store locations that are not linked to a KitStak warehouse.",
    "Link the store location to a warehouse in the channel setup's Warehouse step, or move the order to a linked location, then retry.",
  ),
  entry(
    'Line details not found in the Order',
    'line-details-missing',
    'The order has no line items',
    'The channel returned the order without line item details, so no shipment lines could be created.',
    'Check that the order still has items in your store. If it does, retry the download; if it keeps failing, contact support with the payload.',
  ),
  entry(
    'No Fulfillment Order found with a suitable status for fulfillment',
    'fulfillment-status',
    'No fulfillment order is open for fulfillment',
    "All of the order's fulfillment orders are closed, on hold, cancelled or already in progress elsewhere.",
    'Release any holds on the order in your store (or reopen it), then retry the download.',
  ),
  entry(
    'One or more SKUs could not be created in KitStak',
    'sku-create-failed',
    'One or more products could not be created',
    'KitStak tried to create a product from the store order but the product is missing essential information such as a title or SKU.',
    'Open the product in your store, ensure it has both a Title and a unique SKU, save, and trigger the order download again.',
  ),
  entry(
    'One or more SKUs in the order were not found in KitStak',
    'sku-not-found',
    'One or more SKUs are not set up',
    'The order references SKUs that do not exist in KitStak for this client, and automatic product creation is off.',
    'Create the missing products (or a product listing that maps the store SKU), or enable product creation in the channel setup, then retry.',
  ),
  entry(
    'Open Api Error',
    'open-api-error',
    "The store's API returned an error",
    "The channel's API rejected or failed the request. This is often a temporary outage, an expired token or a revoked app permission.",
    "Check the channel connection's credentials and permissions, reconnect if needed, and retry the download.",
  ),
  entry(
    'Order is Blocked by Archived Filter',
    'archived-filter',
    'The order is archived in the store',
    'The channel setup is configured to skip archived orders, and this order is archived.',
    'Unarchive the order in your store, or turn off the archived-order filter in the channel setup, then retry.',
  ),
  entry(
    'Order is Blocked by Tag Filter',
    'tag-filter',
    'The order is excluded by a tag filter',
    "The order carries a tag that the channel setup's tag filter excludes from download.",
    'Remove the tag from the order in your store, or adjust the tag filter in the channel setup, then retry.',
  ),
  entry(
    'Order lines are already fulfilled on the Store',
    'already-fulfilled',
    'The order is already fulfilled in the store',
    'Every line on the order was fulfilled directly in the store, so there is nothing left for the warehouse to ship.',
    'No action is needed unless the fulfillment was a mistake. If so, cancel the fulfillment in your store and retry.',
  ),
  entry(
    'The Order includes custom products',
    'custom-products',
    'The order contains custom (non-catalog) products',
    'One or more lines are custom items added to the order that do not exist in the store catalog, so they cannot be matched to a SKU.',
    'Replace custom items with catalog products in your store, or create matching products in KitStak, then retry.',
  ),
  entry(
    'The Order includes products without an SKU',
    'missing-sku',
    'The order contains products without an SKU',
    'At least one line has no SKU, so KitStak cannot match it to inventory.',
    'Add a unique SKU to the product variant in your store, save, and retry the download.',
  ),
  entry(
    'Shipment order code already in use',
    'order-code-conflict',
    'KitStak could not assign a shipment order code',
    'The next number in the shipment order sequence was already used by another order, so the order was not created.',
    'Retry the download. If it keeps failing, check the shipment order number sequence in Settings → Data Setup, or contact support.',
  ),
  entry(
    'Unexpected Error',
    'unexpected',
    'An unexpected error occurred',
    'Something went wrong while processing the order that does not match a known cause.',
    'Retry the download. If the error persists, download the payload from this drawer and send it to support.',
  ),
]);

const BY_CODE: ReadonlyMap<string, IntegrationErrorInfo> = new Map(
  INTEGRATION_ERRORS.map((e) => [e.code.toLowerCase(), e]),
);

/** Catalog entry for a code; unknown codes get the "Unexpected Error" guidance with the raw code as title. */
export function integrationError(code: string | null | undefined): IntegrationErrorInfo {
  // Older rows carry "…in LogiwaIO" or "…in KitStaks"; both map to the current "…in KitStak".
  const known = code
    ? BY_CODE.get(
        code
          .trim()
          .replace(/LogiwaIO|KitStaks/gi, 'KitStak')
          .toLowerCase(),
      )
    : undefined;
  if (known) return known;
  const fallback = BY_CODE.get('unexpected error') as IntegrationErrorInfo;
  return code ? { ...fallback, code, title: code } : fallback;
}

export const INTEGRATION_ERROR_CODES: readonly string[] = INTEGRATION_ERRORS.map((e) => e.code);
