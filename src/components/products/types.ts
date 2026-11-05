/** Client-safe types for the Products module (mirrors the repository payloads). */

export type ProductStatus = "Active" | "Inactive";

export interface ProductRow {
  id: string;
  sku: string;
  barcode: string;
  name: string;
  category: string;
  clientId: string;
  clientName: string;
  price: number;
  weightOz: number;
  isKit: boolean;
  status: ProductStatus;
  reorderPoint: number;
  onHand: number;
  allocated: number;
  available: number;
}

export interface ClientOption {
  id: string;
  name: string;
}

export interface ApiMeta {
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: ApiMeta;
}

export type ListingStatus = "Live" | "Paused";

export interface ListingRow {
  id: string;
  productId: string;
  listingSku: string;
  channel: string;
  store: string;
  productName: string;
  clientName: string;
  masterSku: string;
  price: number;
  qtyAvailable: number;
  status: ListingStatus;
  lastSyncedAt: string;
}
