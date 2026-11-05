import type { Metadata } from "next";
import { TransactionHistoryPage } from "@/components/reports/transaction-history-page";

export const metadata: Metadata = { title: "Transaction History Report" };

export default function TransactionHistoryReportPage() {
  return <TransactionHistoryPage />;
}
