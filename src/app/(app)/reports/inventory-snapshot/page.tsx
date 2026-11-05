import type { Metadata } from "next";
import { InventorySnapshotPage } from "@/components/reports/inventory-snapshot-page";

export const metadata: Metadata = { title: "Inventory Snapshot Report" };

export default function InventorySnapshotReportPage() {
  return <InventorySnapshotPage />;
}
