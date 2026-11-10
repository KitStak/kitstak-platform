/**
 * Apps catalog (M14): presentation, the features each app unlocks, and the settings panel
 * (gear) schema per app. Activation state lives in the `apps` table. PURE.
 */
import { z } from "zod";

export type AppTone = "violet" | "blue" | "teal" | "amber" | "rose" | "slate" | "green" | "indigo";

export interface AppSettingField {
  readonly key: string;
  readonly label: string;
  readonly type: "number" | "boolean" | "enum" | "text" | "textarea" | "color" | "secret";
  readonly options?: readonly string[];
  readonly min?: number;
  readonly max?: number;
  readonly suffix?: string;
  readonly help?: string;
  readonly required?: boolean;
  /** Shown (and required, when `required`) only while another field has this value. */
  readonly showWhen?: { readonly key: string; readonly equals: string };
  readonly placeholder?: string;
}

/** True when the field applies to these values (no `showWhen` = always). */
export function fieldApplies(f: AppSettingField, values: Readonly<Record<string, unknown>>): boolean {
  return !f.showWhen || values[f.showWhen.key] === f.showWhen.equals;
}

export interface AppDef {
  readonly key: string;
  readonly icon: string;
  readonly tone: AppTone;
  readonly popular: boolean;
  /** What activation unlocks, in plain words. */
  readonly unlocks: readonly string[];
  /** Where the feature lives once active. */
  readonly openHref?: string;
  readonly openLabel?: string;
  readonly settings: readonly AppSettingField[];
}

export const APP_CATALOG: readonly AppDef[] = [
  {
    key: "ai-jobs", icon: "sparkles", tone: "violet", popular: true,
    unlocks: ["The AI Job type in Wave Rules", "Batches built by walking distance and cart capacity", "LP types flagged Use for AI job"],
    openHref: "/jobs/wave-rules", openLabel: "Open wave rules",
    settings: [
      { key: "maxOrdersPerJob", label: "Max orders per AI job", type: "number", min: 1, max: 500, required: true, help: "Upper bound for one picker's batch" },
      { key: "optimizeFor", label: "Optimize for", type: "enum", options: ["Shortest walking path", "Balanced workload", "Earliest ship date"], required: true },
    ],
  },
  {
    key: "custom-branding", icon: "palette", tone: "rose", popular: false,
    unlocks: ["Your accent color across the app, on printouts and in emails", "Your logo on printouts and a sign-in page message"],
    openHref: "/settings/company", openLabel: "Company settings (logo)",
    settings: [
      { key: "accentColor", label: "Accent color", type: "color", required: true, help: "Buttons, links and active navigation; printout headings" },
      { key: "applyToApp", label: "Use the accent color in the app", type: "boolean", help: "Every user sees it after their next page load" },
      { key: "logoOnPrintouts", label: "Show the company logo on printouts", type: "boolean", help: "The logo comes from Company Settings" },
      { key: "printoutAccent", label: "Use the accent color for printout headings", type: "boolean" },
      { key: "loginMessage", label: "Sign-in page message", type: "text", help: "Shown under the sign-in form, e.g. your support contact", placeholder: "Need access? Contact it-help@yourcompany.com" },
      { key: "emailFooter", label: "Email footer", type: "text", help: "Appended to invites and password emails" },
    ],
  },
  {
    key: "labor-analytics", icon: "users", tone: "blue", popular: true,
    unlocks: ["Average task, associate task, performance quadrant, associate and receiving analyses"],
    openHref: "/analytics/labor/average-task", openLabel: "Open labor analytics",
    settings: [
      { key: "targetUnitsPerHour", label: "Target units per hour", type: "number", min: 1, max: 5000, suffix: "units/h", required: true },
      { key: "excludeIdleMinutes", label: "Exclude idle gaps longer than", type: "number", min: 1, max: 240, suffix: "minutes" },
    ],
  },
  {
    key: "operational-analytics", icon: "chart", tone: "teal", popular: true,
    unlocks: ["Inbound & inventory, fulfillment, management and productivity dashboards"],
    openHref: "/analytics/operational/fulfillment", openLabel: "Open dashboards",
    settings: [{ key: "refreshMinutes", label: "Dashboard refresh", type: "enum", options: ["5", "15", "30", "60"], suffix: "minutes", required: true }],
  },
  {
    key: "scale", icon: "scale", tone: "amber", popular: true,
    unlocks: ["Live weight capture at the packing station (WebSerial scales in Chrome and Edge)", "Weight variance warnings before a label prints"],
    openHref: "/packing-station", openLabel: "Open packing station",
    settings: [
      { key: "unit", label: "Scale unit", type: "enum", options: ["Pound", "Ounce", "Kilogram", "Gram"], required: true },
      { key: "tolerancePercent", label: "Variance warning above", type: "number", min: 0, max: 100, suffix: "%", required: true },
      { key: "autoCapture", label: "Capture automatically when the reading is stable", type: "boolean" },
      { key: "baudRate", label: "Baud rate", type: "enum", options: ["2400", "4800", "9600", "19200"], required: true },
    ],
  },
  {
    key: "sso", icon: "key", tone: "indigo", popular: false,
    unlocks: ["\"Sign in with SSO\" on the sign-in page (OpenID Connect: Okta, Microsoft Entra ID, Google Workspace, Auth0)", "SAML 2.0 service-provider metadata for your identity provider", "Optionally require SSO for every non-admin user"],
    settings: [
      { key: "protocol", label: "Protocol", type: "enum", options: ["OpenID Connect", "SAML 2.0"], required: true },
      { key: "provider", label: "Identity provider", type: "enum", options: ["Okta", "Microsoft Entra ID", "Google Workspace", "Auth0", "Other"], required: true },
      { key: "buttonLabel", label: "Sign-in button label", type: "text", placeholder: "Sign in with Okta", help: "Defaults to \"Sign in with <provider>\"" },
      { key: "issuer", label: "Issuer URL", type: "text", required: true, showWhen: { key: "protocol", equals: "OpenID Connect" }, help: "KitStak reads <issuer>/.well-known/openid-configuration", placeholder: "https://yourcompany.okta.com" },
      { key: "clientId", label: "Client ID", type: "text", required: true, showWhen: { key: "protocol", equals: "OpenID Connect" } },
      { key: "clientSecret", label: "Client secret", type: "secret", required: true, showWhen: { key: "protocol", equals: "OpenID Connect" }, help: "Stored encrypted; never shown again" },
      { key: "entityId", label: "Identity provider entity ID", type: "text", required: true, showWhen: { key: "protocol", equals: "SAML 2.0" } },
      { key: "ssoUrl", label: "Single sign-on URL", type: "text", required: true, showWhen: { key: "protocol", equals: "SAML 2.0" }, help: "Starts with https://" },
      { key: "certificate", label: "X.509 signing certificate", type: "textarea", required: true, showWhen: { key: "protocol", equals: "SAML 2.0" } },
      { key: "allowedDomains", label: "Allowed email domains", type: "text", help: "Comma-separated, e.g. yourcompany.com. Empty = any domain", placeholder: "yourcompany.com" },
      { key: "enforce", label: "Require SSO for every non-admin user", type: "boolean", help: "Password sign-in keeps working for admins (break-glass)" },
    ],
  },
  {
    key: "two-boxes", icon: "boxes", tone: "green", popular: false,
    unlocks: ["Ship one order in two boxes from the packing station", "Two labels per order with box-level contents"],
    openHref: "/packing-station", openLabel: "Open packing station",
    settings: [{ key: "maxBoxes", label: "Max boxes per order", type: "number", min: 2, max: 10, required: true }],
  },
  {
    key: "api-user", icon: "code", tone: "slate", popular: false,
    unlocks: ["API users with token access for integrations"],
    openHref: "/settings/users?f.isApiUser=bool:true", openLabel: "Show API users",
    settings: [{ key: "tokenDays", label: "Token lifetime", type: "number", min: 1, max: 365, suffix: "days", required: true }],
  },
  { key: "bukuship", icon: "truck", tone: "blue", popular: false, unlocks: ["BukuShip carrier rates and labels"], openHref: "/integrations/carriers", openLabel: "Carrier integrations", settings: [] },
  { key: "dropstream", icon: "plug", tone: "teal", popular: false, unlocks: ["Dropstream order and inventory sync"], openHref: "/integrations/channels", openLabel: "Channel integrations", settings: [] },
  { key: "ehub", icon: "truck", tone: "indigo", popular: false, unlocks: ["Ehub carrier rates and labels"], openHref: "/integrations/carriers", openLabel: "Carrier integrations", settings: [] },
  { key: "locad-oms", icon: "plug", tone: "green", popular: false, unlocks: ["Locad OMS order sync"], openHref: "/integrations/channels", openLabel: "Channel integrations", settings: [] },
  { key: "locus", icon: "robot", tone: "amber", popular: false, unlocks: ["Locus robots for assisted picking"], settings: [{ key: "siteId", label: "Locus site ID", type: "text", required: true }] },
  { key: "shipium", icon: "truck", tone: "violet", popular: false, unlocks: ["Shipium carrier selection and labels"], openHref: "/integrations/carriers", openLabel: "Carrier integrations", settings: [] },
  { key: "techship", icon: "plug", tone: "rose", popular: false, unlocks: ["Techship store connections"], openHref: "/integrations/channels", openLabel: "Channel integrations", settings: [] },
  { key: "eshipper", icon: "truck", tone: "slate", popular: false, unlocks: ["eShipper carrier rates and labels"], openHref: "/integrations/carriers", openLabel: "Carrier integrations", settings: [] },
];

const BY_KEY: ReadonlyMap<string, AppDef> = new Map(APP_CATALOG.map((a) => [a.key, a]));

export function getAppDef(key: string): AppDef | undefined {
  return BY_KEY.get(key);
}

export const APP_TABS = ["popular", "active", "all"] as const;
export type AppTab = (typeof APP_TABS)[number];

/** https://, or http:// on localhost (a local test identity provider). */
export const isSecureUrl = (raw: string): boolean => /^https:\/\/\S+$/i.test(raw) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/\S*)?$/i.test(raw);

/** zod schema for an app's settings panel, built from its field list. */
export function appSettingsSchema(def: AppDef, opts: { readonly savedSecrets?: ReadonlySet<string> } = {}) {
  const shape: Record<string, z.ZodType> = {};
  const conditional: AppSettingField[] = [];
  for (const f of def.settings) {
    let s: z.ZodType;
    if (f.required && (f.showWhen || f.type === "secret")) conditional.push(f);
    if (f.type === "secret") {
      // Blank keeps the saved secret; the server stores it encrypted and returns only a hint.
      shape[f.key] = z.string().trim().max(2000, "Too long").default("");
      continue;
    }
    if (f.showWhen) {
      shape[f.key] = f.type === "boolean" ? z.boolean().default(false) : f.type === "number" ? z.number().nullable().optional() : z.string().trim().max(f.type === "textarea" ? 8000 : 300, "Too long").nullable().optional().default("");
      continue;
    }
    if (f.type === "number") {
      let n = z.number({ error: `${f.label} must be a number` }).int("Whole number");
      if (f.min !== undefined) n = n.min(f.min, `At least ${f.min}`);
      if (f.max !== undefined) n = n.max(f.max, `At most ${f.max}`);
      s = f.required ? n : n.nullable().optional();
    } else if (f.type === "boolean") s = z.boolean().default(false);
    else if (f.type === "enum") s = f.required ? z.enum(f.options as [string, ...string[]], { error: `Choose ${f.label.toLowerCase()}` }) : z.enum(f.options as [string, ...string[]]).nullable().optional();
    else if (f.type === "color") s = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex color like #4F46E5");
    else {
      let t = z.string().trim().max(f.type === "textarea" ? 8000 : 300, "Too long");
      if (f.required) t = t.min(1, `${f.label} is required`);
      s = f.required ? t : t.optional().default("");
    }
    shape[f.key] = s;
  }
  return z.object(shape).superRefine((v, ctx) => {
    const values = v as Record<string, unknown>;
    for (const f of conditional) {
      if (!fieldApplies(f, values)) continue;
      const raw = values[f.key];
      const empty = raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "");
      if (empty && f.type === "secret" && opts.savedSecrets?.has(f.key)) continue;
      if (empty) ctx.addIssue({ code: "custom", path: [f.key], message: `${f.label} is required` });
      else if ((f.key === "ssoUrl" || f.key === "issuer") && typeof raw === "string" && !isSecureUrl(raw)) {
        ctx.addIssue({ code: "custom", path: [f.key], message: "Use an https:// URL" });
      }
    }
  });
}

/** Defaults shown the first time a panel opens. */
export function defaultAppSettings(def: AppDef): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of def.settings) {
    if (f.type === "boolean") out[f.key] = false;
    else if (f.type === "number") out[f.key] = f.min ?? 1;
    else if (f.type === "enum") out[f.key] = f.options?.[0] ?? "";
    else if (f.type === "color") out[f.key] = "#4F46E5";
    else if (f.type === "secret") out[f.key] = "";
    else out[f.key] = "";
  }
  return out;
}
