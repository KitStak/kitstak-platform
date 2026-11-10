// @vitest-environment jsdom
import "../foundation-f4a/dom-shims";
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const routerPush = vi.fn();
let pathname = "/orders/shipped";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
}));

import { NAV_MENUS, USER_MENU_ITEMS } from "@/config/nav-config";
import { visibleMenus } from "@/config/nav-access";
import { QueryProvider } from "@/lib/query-client";
import { MegaMenuBar } from "@/components/layout/mega-menu";
import { PageHeader } from "@/components/layout/page-header";
import { ShellProvider } from "@/components/layout/shell-context";
import { GlobalSearch } from "@/components/layout/global-search";
import { NotificationItem } from "@/components/layout/notification-item";

beforeEach(() => {
  routerPush.mockReset();
  pathname = "/orders/shipped";
  window.localStorage.clear();
});

describe("MegaMenuBar", () => {
  it("renders the permission-filtered menus and marks the active trigger", async () => {
    const user = userEvent.setup();
    const menus = visibleMenus(NAV_MENUS, new Set(["fulfillment.shipment_orders.view", "inventory.total_inventory.view"]));
    render(<MegaMenuBar menus={menus} dashboardHref="/dashboard" />);
    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    expect(within(nav).getAllByRole("button").map((b) => b.textContent)).toEqual(["Fulfillment", "Inventory"]);
    await user.click(within(nav).getByRole("button", { name: "Fulfillment" }));
    const panel = await screen.findByRole("region", { name: "Outbound" });
    expect(within(panel).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/orders", "/orders/shipped"]);
    expect(within(panel).getByRole("link", { name: "Shipped Orders" }).getAttribute("aria-current")).toBe("page");
  });
});

describe("PageHeader", () => {
  it("derives breadcrumbs and filters route tabs by permission", () => {
    render(
      <ShellProvider user={{ id: "u", name: "Pat", email: "p@x.io", role: "operator" }} permissions={["fulfillment.shipment_orders.view"]}>
        <PageHeader title="Shipped Orders" tabs="orders" helper="Helper text" actions={<button type="button">Export</button>} />
      </ShellProvider>,
    );
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(crumbs.textContent).toBe("HomeFulfillmentShipped Orders");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Shipped Orders");
    const tabs = screen.getByRole("navigation", { name: "orders sections" });
    expect(within(tabs).getAllByRole("link").map((a) => a.textContent)).toEqual(["Order Backlog", "Shipped & Canceled Orders"]);
    expect(within(tabs).getByRole("link", { name: "Shipped & Canceled Orders" }).getAttribute("aria-current")).toBe("page");
  });

  it("accepts explicit breadcrumbs and a current-crumb override", () => {
    pathname = "/orders/abc";
    const { rerender } = render(<PageHeader title="Order" crumbLabel="SO010421" />);
    expect(screen.getByRole("navigation", { name: "Breadcrumb" }).textContent).toBe("HomeFulfillmentShipment OrdersSO010421");
    rerender(<PageHeader title="Custom" breadcrumbs={[{ label: "A", href: "/a" }, { label: "B" }]} />);
    expect(screen.getByRole("navigation", { name: "Breadcrumb" }).textContent).toBe("HomeAB");
  });
});

describe("GlobalSearch", () => {
  it("opens on Ctrl+K, shows bold page matches and navigates", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true, data: [] }), { status: 200, headers: { "content-type": "application/json" } })));
    render(<QueryProvider><GlobalSearch menus={NAV_MENUS} extraPages={USER_MENU_ITEMS} /></QueryProvider>);
    await user.keyboard("{Control>}k{/Control}");
    const input = await screen.findByPlaceholderText(/Search in pages/);
    await user.type(input, "wave");
    await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(0));
    const option = screen.getAllByRole("option").find((o) => o.textContent?.startsWith("Wave Rules"));
    if (!option) throw new Error(screen.getAllByRole("option").map((o) => o.textContent).join(" / "));
    expect(option.querySelector("strong")?.textContent).toBe("Wave");
    await user.click(option);
    expect(routerPush).toHaveBeenCalledWith("/jobs/wave-rules");
    expect(JSON.parse(window.localStorage.getItem("ks:recent-searches") ?? "[]")).toEqual(["wave"]);
    vi.unstubAllGlobals();
  });
});

describe("NotificationItem", () => {
  it("opens and marks read", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onMarkRead = vi.fn();
    render(
      <ul>
        <NotificationItem notification={{ id: "n1", kind: "wave.completed", title: "Wave 101 completed", body: "All orders allocated", href: "/jobs", severity: "success", readAt: null, createdAt: "2026-11-05T10:00:00.000Z" }} onOpen={onOpen} onMarkRead={onMarkRead} />
      </ul>,
    );
    await user.click(screen.getByRole("button", { name: /^Wave 101 completeds*All orders/ }));
    await user.click(screen.getByRole("button", { name: 'Mark "Wave 101 completed" as read' }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
    expect(onMarkRead).toHaveBeenCalledTimes(1);
  });
});
