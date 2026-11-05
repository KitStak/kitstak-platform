import type { Metadata } from "next";
import { ReportsHubPage } from "@/components/reports/reports-hub";

export const metadata: Metadata = { title: "Reports" };

export default function ReportsPage() {
  return <ReportsHubPage />;
}
