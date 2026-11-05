import type { Metadata } from "next";
import { ReceivingPage } from "@/components/receiving/receiving-page";

export const metadata: Metadata = { title: "Purchase Orders" };

export default function Page() {
  return <ReceivingPage />;
}
