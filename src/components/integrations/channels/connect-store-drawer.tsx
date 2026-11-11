"use client";

/**
 * Connect Store drawer (spec 06 §7a): Custom App (store name 0/60, Access Token or Client ID &
 * Secret, client, REST/GraphQL; Continue validates live), Public App (OAuth, gated by
 * server configuration) and KitStak Sandbox (always available). Labels per channel come from
 * `channelCredentialProfile` (WooCommerce consumer key, Amazon LWA + refresh token, ...).
 */
import * as React from "react";
import { FlaskConical, KeyRound, ShieldCheck, Store } from "lucide-react";
import { apiRequest, isApiError } from "@/lib/api-client";
import { STORE_NAME_MAX, channelCredentialProfile } from "@/lib/grid-defs/integrations/channels";
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
      <label htmlFor={id} className="text-xs font-medium text-body">{label}{required ? <span className="text-danger"> *</span> : null}</label>
      {children}
      {error ? <p id={`${id}-error`} role="alert" className="text-xs text-danger">{error}</p> : hint ? <p className="text-2xs text-faint">{hint}</p> : null}
    </div>
  );
}

export function ConnectStoreDrawer({ open, onOpenChange, provider, providerName, hasLiveApi, publicAppEnabled, onConnected }: {
  readonly open: boolean; readonly onOpenChange: (o: boolean) => void; readonly provider: string; readonly providerName: string; readonly hasLiveApi: boolean;
  readonly publicAppEnabled: boolean; readonly onConnected: (detail: ChannelConnectionDetail) => void;
}) {
  const clients = useClientOptions();
  const profile = channelCredentialProfile(provider);
  const defaultAuth = (profile.authMethods[0] ?? "Access Token") as "Access Token" | "Client ID & Secret";
  const [extra, setExtra] = React.useState<Record<string, string>>({});
  const [mode, setMode] = React.useState<Mode>(hasLiveApi ? "Custom App" : "API");
  const [storeName, setStoreName] = React.useState("");
  const [authMethod, setAuthMethod] = React.useState<"Access Token" | "Client ID & Secret">(defaultAuth);
  const [accessToken, setAccessToken] = React.useState("");
  const [apiClientId, setApiClientId] = React.useState("");
  const [apiClientSecret, setApiClientSecret] = React.useState("");
  const [clientId, setClientId] = React.useState<string | null>(null);
  const [apiVersion, setApiVersion] = React.useState<"Rest API" | "GraphQL">("GraphQL");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, setPending] = React.useState(false);
  const dirty = Boolean(storeName || accessToken || apiClientId || apiClientSecret || clientId);
  React.useEffect(() => { if (!open) { setStoreName(""); setAccessToken(""); setApiClientId(""); setApiClientSecret(""); setClientId(null); setErrors({}); setExtra({}); setAuthMethod(defaultAuth); setMode(hasLiveApi ? "Custom App" : "API"); } }, [open, hasLiveApi, defaultAuth]);
  // The catalog (hasLiveApi) can arrive after the drawer opened from ?connect=1: default to Custom App once it does.
  React.useEffect(() => { if (open && hasLiveApi) setMode((m) => (m === "API" && !dirty ? "Custom App" : m)); }, [open, hasLiveApi]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    const next: Record<string, string> = {};
    if (!clientId) next.clientId = "Client is required";
    if (!storeName.trim()) next.storeName = "Store name is required";
    if (mode === "Custom App" && authMethod === "Access Token" && !accessToken.trim()) next.accessToken = `${profile.tokenLabel} is required`;
    if (mode === "Custom App" && authMethod === "Client ID & Secret") {
      if (!apiClientId.trim()) next.apiClientId = `${profile.clientIdLabel} is required`;
      if (!apiClientSecret.trim()) next.apiClientSecret = `${profile.clientSecretLabel} is required`;
    }
    if (mode === "Custom App") for (const x of profile.extra) if (x.required && !extra[x.key]?.trim()) next[x.key] = `${x.label} is required`;
    setErrors(next);
    const first = Object.keys(next)[0];
    if (first) { document.getElementById(`cs-${first}`)?.focus(); return; }
    setPending(true);
    if (mode === "Public App") {
      // OAuth install: Shopify asks the merchant to approve the KitStak app, then redirects back to the connection list.
      try {
        const { data } = await apiRequest<{ url: string }>("/api/channels/shopify/install", { method: "POST", body: { storeName: storeName.trim(), clientId } });
        window.location.assign(data.url);
      } catch (error) {
        if (isApiError(error)) {
          const fe: Record<string, string> = {};
          for (const [k, v] of Object.entries(error.fieldErrors)) if (v[0]) fe[k] = v[0];
          setErrors(fe);
        }
        toast.error("Couldn't start the Shopify install", isApiError(error) ? error.message : "Something went wrong");
        setPending(false);
      }
      return;
    }
    try {
      const { data } = await apiRequest<ChannelConnectionDetail>("/api/channels", { method: "POST", body: {
        provider, distribution: mode, storeName: storeName.trim(), clientId, authMethod, apiVersion,
        ...(mode === "Custom App" ? (authMethod === "Access Token" ? { accessToken } : { apiClientId, apiClientSecret }) : {}),
        ...(mode === "Custom App" ? Object.fromEntries(profile.extra.map((x) => [x.key, extra[x.key]?.trim() || undefined])) : {}),
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
          { value: "Custom App", title: "Custom App", description: hasLiveApi ? (provider === "shopify" ? "Paste the Admin API credentials of a custom app." : `Paste your ${providerName} API credentials.`) : "Live API not available for this channel yet.", icon: KeyRound, disabled: !hasLiveApi },
          { value: "Public App", title: "Public App", description: publicAppEnabled ? "Approve the KitStak app on the store; no keys to copy." : provider === "shopify" ? "One-click install: needs the workspace's Shopify app keys (see below)." : `No public app for ${providerName} yet.`, icon: ShieldCheck, disabled: !publicAppEnabled },
          { value: "API", title: "KitStak Sandbox", description: "A realistic test store that generates orders on every run.", icon: FlaskConical, badge: "NEW" },
        ]} />
        {provider === "shopify" && !publicAppEnabled ? (
          <p className="-mt-2 rounded-lg border border-border bg-surface-sunken/60 px-3 py-2 text-xs leading-relaxed text-secondary">
            One-click install is built (OAuth with signed state and HMAC check) but needs this workspace&apos;s own Shopify app: an administrator creates an app in a Shopify Partner account, adds the redirect URL <code className="rounded bg-surface px-1 text-foreground">{typeof window === "undefined" ? "" : window.location.origin}/api/channels/shopify/callback</code>, and sets <code className="rounded bg-surface px-1 text-foreground">SHOPIFY_CLIENT_ID</code> and <code className="rounded bg-surface px-1 text-foreground">SHOPIFY_CLIENT_SECRET</code> on the server. Until then, connect with a Custom App access token.
          </p>
        ) : null}
        <Field id="cs-clientId" label="Client" required error={errors.clientId} hint="Orders, products and inventory of this store belong to this client.">
          <Combobox id="cs-clientId" aria-label="Client" options={clients} value={clientId} onChange={(v) => { setClientId(v); setErrors((e) => ({ ...e, clientId: "" })); }} placeholder="Select client" invalid={Boolean(errors.clientId)} />
        </Field>
        {mode === "Public App" ? (
          <>
            <Callout variant="info" title="You'll approve the app on the store">You’ll go to {providerName} to approve the KitStak app. Click Install there and you’re brought straight back here with the store connected; then link its locations and turn on the methods you want.</Callout>
            <Field id="cs-storeName" label="Your Shopify store name" required error={errors.storeName} hint="e.g. bluebird-main (we connect to bluebird-main.myshopify.com)">
              <TextField id="cs-storeName" value={storeName} maxLength={STORE_NAME_MAX} invalid={Boolean(errors.storeName)} leading={<Store className="h-4 w-4" />} trailing={<span className="text-xs text-secondary">.myshopify.com</span>}
                placeholder="bluebird-main" onChange={(e) => { setStoreName(e.target.value); setErrors((x) => ({ ...x, storeName: "" })); }} />
            </Field>
          </>
        ) : (
          <Field id="cs-storeName" label={mode === "API" ? "Sandbox store name" : profile === channelCredentialProfile("") ? `Your ${providerName} store name` : profile.storeLabel} required error={errors.storeName}
            hint={mode === "API" ? "Shown as the Store on every downloaded order." : profile.storeHint || undefined}>
            <TextField id="cs-storeName" value={storeName} maxLength={STORE_NAME_MAX} showCount invalid={Boolean(errors.storeName)} leading={<Store className="h-4 w-4" />}
              placeholder={mode === "API" ? "e.g. Apex Threads Sandbox" : profile.storePlaceholder} onChange={(e) => { setStoreName(e.target.value); setErrors((x) => ({ ...x, storeName: "" })); }} />
          </Field>
        )}
        {mode === "Custom App" ? (
          <>
            {profile.help ? <Callout variant="info" title={`Where to find your ${providerName} credentials`}>{profile.help}</Callout> : null}
            {profile.authMethods.length > 1 ? (
              <Field id="cs-auth" label="Select authorization method">
                <SegmentedControl ariaLabel="Authorization method" className="w-full [&>button]:flex-1" value={authMethod} onChange={setAuthMethod}
                  options={profile.authMethods.filter((m) => m !== "OAuth").map((m) => ({ value: m as "Access Token" | "Client ID & Secret", label: m }))} />
              </Field>
            ) : null}
            {authMethod === "Access Token" ? (
              <Field id="cs-accessToken" label={profile.tokenLabel} required error={errors.accessToken} hint="Stored encrypted; only the last 4 characters are ever shown.">
                <TextField id="cs-accessToken" type="password" autoComplete="off" value={accessToken} invalid={Boolean(errors.accessToken)} onChange={(e) => { setAccessToken(e.target.value); setErrors((x) => ({ ...x, accessToken: "" })); }} />
              </Field>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                <Field id="cs-apiClientId" label={profile.clientIdLabel} required error={errors.apiClientId}><TextField id="cs-apiClientId" autoComplete="off" value={apiClientId} invalid={Boolean(errors.apiClientId)} onChange={(e) => setApiClientId(e.target.value)} /></Field>
                <Field id="cs-apiClientSecret" label={profile.clientSecretLabel} required error={errors.apiClientSecret}><TextField id="cs-apiClientSecret" type="password" autoComplete="off" value={apiClientSecret} invalid={Boolean(errors.apiClientSecret)} onChange={(e) => setApiClientSecret(e.target.value)} /></Field>
              </div>
            )}
            {profile.extra.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2">
                {profile.extra.map((x) => (
                  <Field key={x.key} id={`cs-${x.key}`} label={x.label} required={x.required} error={errors[x.key]} hint={x.hint}>
                    <TextField id={`cs-${x.key}`} type={x.secret ? "password" : "text"} autoComplete="off" value={extra[x.key] ?? ""} placeholder={x.placeholder} invalid={Boolean(errors[x.key])}
                      onChange={(e) => { const v = e.target.value; setExtra((s) => ({ ...s, [x.key]: v })); setErrors((er) => ({ ...er, [x.key]: "" })); }} />
                  </Field>
                ))}
              </div>
            ) : null}
            {profile.apiVersionChoice ? (
              <Field id="cs-api" label="API version">
                <SegmentedControl ariaLabel="API version" className="w-full [&>button]:flex-1" value={apiVersion} onChange={setApiVersion} options={[{ value: "Rest API", label: "Rest API" }, { value: "GraphQL", label: "GraphQL" }]} />
              </Field>
            ) : null}
          </>
        ) : null}
      </div>
    </Drawer>
  );
}
