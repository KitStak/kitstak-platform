import type { Metadata } from "next";
import { IntegrationHelpCenter } from "@/components/integrations/help/integration-help-center";
import { CARRIERS, CHANNELS } from "@/lib/channel-catalog";
import { integrationLiveStatus } from "@/server/repositories/channels";
import { shopifyPublicAppConfig } from "@/server/integrations/shopify-oauth";

export const metadata: Metadata = { title: "Integration Help Center" };

/** Integration Help Center (M12): how to connect every channel and carrier, what each method does, and live vs sandbox status. */
export default function Page() {
  const entries = [...CHANNELS, ...CARRIERS].map((e) => ({
    key: e.key, name: e.name, kind: e.kind, availability: e.availability, description: e.description,
    live: e.key !== "kitstaks-sandbox" && integrationLiveStatus(e.kind, e.key),
  }));
  return <IntegrationHelpCenter entries={entries} shopifyPublicApp={shopifyPublicAppConfig() !== null} />;
}
