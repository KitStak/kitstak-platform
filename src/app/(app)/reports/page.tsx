import type { Metadata } from "next";
import { ReportsHub } from "@/components/reports/reports-hub";

export const metadata: Metadata = { title: "Report Hub" };

export default function ReportsPage() {
  return <ReportsHub />;
}
