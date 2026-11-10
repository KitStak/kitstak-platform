"use client";

/**
 * Connect Store drawer (spec 06 §7a): Custom App (store name 0/60, Access Token or Client ID &
 * Secret, client, REST/GraphQL; Continue validates live), Public App (OAuth, gated by
 * SHOPIFY_CLIENT_ID) and KitStaks Sandbox (always available).
 */
import * as React from "react";
import { FlaskConical, KeyRound, ShieldCheck, Store } from "lucide-react";
import { apiRequest, isApiError } from "@/lib/api-client";
import { STORE_NAME_MAX } from "@/lib/grid-defs/integrations/channels";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Combobox } from "@/components/ui/combobox";
import { Drawer } from "@/components/ui/drawer";
import { RadioCards } from "@/components/ui/radio-cards";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Spinner } from "@/components/ui/spinner";
import { TextField } from "@/components/ui/text-field";
import { toast } from "@/components/ui/toast";
import { useClientOptions } from "@/components/integrations/shared/shared";
import type { ChannelConnectionDetail } from "@/server/repositories/channels";

type Mode = "Custom App" | "Public App" | "API";

function Field({ id, label, required, error, children, hint }: { readonly id: string; readonly label: string; readonly required?: boolean; readonly error?: string; readonly children: React.ReactNode; readonly hint?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[12px] font-medium text-body">{label}{required ? <span className="text-danger"> *</span> : null}</label>
      {children}
      {error ? <p id={`${id}-error`} role="alert" className="text-[12px] text-danger">{error}</p> : hint ? <p className="text-[11px] text-faint">{hint}</p> : null}
    </div>
  );
}

export function ConnectStoreDrawer({ open, onOpenChange, provider, providerName, hasLiveApi, publicAppEnabled, onConnected }: {
  readonly open: boolean; readonly onOpenChange: (o: boolean) => void; readonly provider: string; readonly providerName: string; readonly hasLiveApi: boolean;
  readonly publicAppEnabled: boolean; readonly onConnected: (detail: ChannelConnectionDetail) => void;
}) {
  const clients = useClientOptions();
  const [mode, setMode] = React.useState<Mode>(hasLiveApi ? "Custom App" : "API");
  const [storeName, setStoreName] = React.useState("");
  const [authMethod, setAuthMethod] = React.useState<"Access Token" | "Client ID & Secret">("Access Token");
  const [accessToken, setAccessToken] = React.useState("");
  const [apiClientId, setApiClientId] = React.useState("");
  const [apiClientSecret, setApiClientSecret] = React.useState("");
  const [clientId, setClientId] = React.useState<string | null>(null);
  const [apiVersion, setApiVersion] = React.useState<"Rest API" | "GraphQL">("GraphQL");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, setPending] = React.useState(false);
  const dirty = Boolean(storeName || accessToken || apiClientId || apiClientSecret || clientId);
  React.useEffect(() => { if (!open) { setStoreName(""); setAccessToken(""); setApiClientId(""); setApiClientSecret(""); setClientId(null); setErrors({}); setMode(hasLiveApi ? "Custom App" : "API"); } }, [open, hasLiveApi]);

  const submit = async () => {
    const next: Record<string, string> = {};
    if (!clientId) next.clientId = "Client is required";
    if (mode !== "Public App" && !storeName.trim()) next.storeName = "Store name is required";
    if (mode === "Custom App" && authMethod === "Access Token" && !accessToken.trim()) next.accessToken = "Access token is required";
    if (mode === "Custom App" && authMethod === "Client ID & Secret") {
      if (!apiClientId.trim()) next.apiClientId = "Client ID is required";
      if (!apiClientSecret.trim()) next.apiClientSecret = "Client secret is required";
    }
    setErrors(next);
    const first = Object.keys(next)[0];
    if (first) { document.getElementById(`cs-${first}`)?.focus(); return; }
    setPending(true);
    try {
      const { data } = await apiRequest<ChannelConnectionDetail>("/api/channels", { method: "POST", body: {
        provider, distribution: mode, storeName: storeName.trim(), clientId, authMethod, apiVersion,
        ...(mode === "Custom App" ? (authMethod === "Access Token" ? { accessToken } : { apiClientId, apiClientSecret }) : {}),
      } });
      toast.success("Store connected", mode === "API" ? `${data.storeName} is ready. Link its locations, then turn on the methods you want.` : `${data.storeName} accepted the credentials.`);
      onConnected(data);
    } catch (error) {
      if (isApiError(error)) {
        const fe: Record<string, string> = {};
        for (const [k, v] of Object.entries(error.fieldErrors)) if (v[0]) fe[k] = v[0];
        setErrors(fe);
        const f = Object.keys(fe)[0];
        if (f) document.getElementById(`cs-${f}`)?.focus();
      }
      toast.error("Couldn't connect the store", isApiError(error) ? error.message : "Something went wrong");
    } finally {
      setPending(false);
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange} dirty={dirty} width={45} title={`Connect ${providerName} store`} description="Select app distribution type, then connect the store to a client."
      footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant="primary" onClick={() => void submit()} disabled={pending || (mode === "Public App" && !publicAppEnabled)}>{pending ? <Spinner className="h-3.5 w-3.5" /> : null}{mode === "Public App" ? `Connect to ${providerName}` : "Continue"}</Button></div>}>
      <div className="flex flex-col gap-5" onKeyDown={(e) => { if (e.key === "Enter" && e.target instanceof HTMLInputElement) { e.preventDefault(); void submit(); } }}>
        <RadioCards<Mode> ariaLabel="App distribution type" columns={3} value={mode} onChange={(v) => { setMode(v); setErrors({}); }} options={[
          { value: "Custom App", title: "Custom App", description: hasLiveApi ? "Paste the Admin API credentials of a custom app." : "Live API not available for this channel yet.", icon: KeyRound, disabled: !hasLiveApi },
          { value: "Public App", title: "Public App", description: publicAppEnabled ? "Approve the KitStaks app on the store; no keys to copy." : "Needs SHOPIFY_CLIENT_ID on the server.", icon: ShieldCheck, disabled: !publicAppEnabled },
          { value: "API", title: "KitStaks Sandbox", description: "A realistic test store that generates orders on every run.", icon: FlaskConical, badge: "NEW" },
        ]} />
        <Field id="cs-clientId" label="Client" required error={errors.clientId} hint="Orders, products and inventory of this store belong to this client.">
          <Combobox id="cs-clientId" aria-label="Client" options={clients} value={clientId} onChange={(v) => { setClientId(v); setErrors((e) => ({ ...e, clientId: "" })); }} placeholder="Select client" invalid={Boolean(errors.clientId)} />
        </Field>
        {mode === "Public App" ? (
          <Callout variant="info" title="You'll approve the app on the store">You'll be redirected to {providerName} in a new tab to approve the KitStaks app. Click Install, then come back to this tab to finish the setup.</Callout>
        ) : (
          <Field id="cs-storeName" label={mode === "API" ? "Sandbox store name" : `Your ${providerName} store name`} required error={errors.storeName}
            hint={mode === "API" ? "Shown as the Store on every downloaded order." : provider === "shopify" ? "e.g. bluebird-main (we connect to bluebird-main.myshopify.com)" : undefined}>
            <TextField id="cs-storeName" value={storeName} maxLength={STORE_NAME_MAX} showCount invalid={Boolean(errors.storeName)} leading={<Store className="h-4 w-4" />}
              placeholder={mode === "API" ? "e.g. Apex Threads Sandbox" : "Store name"} onChange={(e) => { setStoreName(e.target.value); setErrors((x) => ({ ...x, storeName: "" })); }} />
          </Field>
        )}
        {mode === "Custom App" ? (
          <>
            <Field id="cs-auth" label="Select authorization method">
              <SegmentedControl ariaLabel="Authorization method" value={authMethod} onChange={setAuthMethod} options={[{ value: "Access Token", label: "Access Token" }, { value: "Client ID & Secret", label: "Client ID & Secret" }]} />
            </Field>
            {authMethod === "Access Token" ? (
              <Field id="cs-accessToken" label="Access token" required error={errors.accessToken} hint="Stored encrypted; only the last 4 characters are ever shown.">
                <TextField id="cs-accessToken" type="password" autoComplete="off" value={accessToken} invalid={Boolean(errors.accessToken)} onChange={(e) => { setAccessToken(e.target.value); setErrors((x) => ({ ...x, accessToken: "" })); }} />
              </Field>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                <Field id="cs-apiClientId" label="Client ID" required error={errors.apiClientId}><TextField id="cs-apiClientId" autoComplete="off" value={apiClientId} invalid={Boolean(errors.apiClientId)} onChange={(e) => setApiClientId(e.target.value)} /></Field>
                <Field id="cs-apiClientSecret" label="Client secret" required error={errors.apiClientSecret}><TextField id="cs-apiClientSecret" type="password" autoComplete="off" value={apiClientSecret} invalid={Boolean(errors.apiClientSecret)} onChange={(e) => setApiClientSecret(e.target.value)} /></Field>
              </div>
            )}
            <Field id="cs-api" label="API version">
              <SegmentedControl ariaLabel="API version" value={apiVersion} onChange={setApiVersion} options={[{ value: "Rest API", label: "Rest API" }, { value: "GraphQL", label: "GraphQL" }]} />
            </Field>
          </>
        ) : null}
      </div>
    </Drawer>
  );
}
