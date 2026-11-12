/**
 * Product Listings grid definition (spec 05 §2; rows/actions KitStaks-designed, Part D).
 * PURE: shared by the client filter builder and `/api/listings`.
 */
export const LISTINGS_GRID_KEY = 'product-listings';

export const LISTING_LINK_STATES = ['unlinked', 'linked'] as const;
export type ListingLinkState = (typeof LISTING_LINK_STATES)[number];

export type ListingOptionSource = 'clients' | 'stores' | 'tags';

/**
 * Derived listing exceptions (spec 05 §2 + M12 "Product Listing Exceptions"):
 * - `unlinked`: no KitStaks product, so orders for it cannot be fulfilled;
 * - `sku_difference`: linked to a product whose SKU differs from the seller SKU;
 * - `multi_listing`: another listing of the same store points at the same product.
 * Linking an unlinked listing to its matching SKU clears the exception.
 */
export const LISTING_EXCEPTIONS = ['unlinked', 'sku_difference', 'multi_listing'] as const;
export type ListingException = (typeof LISTING_EXCEPTIONS)[number];
export const LISTING_EXCEPTION_LABELS: Readonly<Record<ListingException, string>> = {
  unlinked: 'Missing product',
  sku_difference: 'SKU difference',
  multi_listing: 'Multi listing',
};

export interface ListingGridField {
  readonly field: string;
  readonly label: string;
  readonly type: 'enum' | 'text' | 'number' | 'boolean';
  readonly optionsFrom?: ListingOptionSource;
  readonly decimals?: number;
  readonly options?: readonly { readonly value: string; readonly label: string }[];
}

/** The ten Logiwa filters, plus Exception (beyond Logiwa). */
export const LISTING_GRID_FIELDS: readonly ListingGridField[] = [
  { field: 'storePrice', label: 'Channel product price', type: 'number', decimals: 2 },
  { field: 'clientId', label: 'Client', type: 'enum', optionsFrom: 'clients' },
  { field: 'neverSync', label: 'Never sync', type: 'boolean' },
  { field: 'sellerSku', label: 'Seller SKU', type: 'text' },
  { field: 'productSku', label: 'SKU', type: 'text' },
  { field: 'channelConnectionId', label: 'Store', type: 'enum', optionsFrom: 'stores' },
  { field: 'storeName', label: 'Store name', type: 'text' },
  { field: 'name', label: 'Store product name', type: 'text' },
  { field: 'channelProductId', label: 'Store SKU', type: 'text' },
  { field: 'tagId', label: 'Tag', type: 'enum', optionsFrom: 'tags' },
  {
    field: 'exception',
    label: 'Exception',
    type: 'enum',
    options: LISTING_EXCEPTIONS.map((e) => ({ value: e, label: LISTING_EXCEPTION_LABELS[e] })),
  },
];

export const LISTING_SORT_FIELDS = [
  'name',
  'storeName',
  'sellerSku',
  'channelProductId',
  'description',
  'storePrice',
  'productSku',
  'neverSync',
  'productType',
  'productGroup',
  'clientName',
  'createdAt',
  'linkedAt',
  'exception',
] as const;

export const LISTING_SEARCH_FIELDS = ['sellerSku', 'name', 'channelProductId'] as const;

export const LISTING_EXPORT_COLUMNS: readonly {
  key: string;
  label: string;
  type?: 'text' | 'money' | 'boolean' | 'datetime';
}[] = [
  { key: 'name', label: 'Product name' },
  { key: 'storeName', label: 'Store name' },
  { key: 'clientName', label: 'Client' },
  { key: 'sellerSku', label: 'Seller SKU' },
  { key: 'channelProductId', label: 'Channel ID' },
  { key: 'description', label: 'Description' },
  { key: 'storePrice', label: 'Store price', type: 'money' },
  { key: 'tagNames', label: 'Tags' },
  { key: 'productSku', label: 'KitStaks product' },
  { key: 'neverSync', label: 'Never sync', type: 'boolean' },
  { key: 'productType', label: 'Product type' },
  { key: 'productGroup', label: 'Product group' },
  { key: 'linkedAt', label: 'Linked at', type: 'datetime' },
  { key: 'exceptionLabel', label: 'Exception' },
];
