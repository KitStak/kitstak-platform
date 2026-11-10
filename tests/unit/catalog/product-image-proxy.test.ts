import { afterEach, describe, expect, it, vi } from "vitest";
import { clearProductImageCache, getProductImage, ImageProxyError, isBlockedAddress, parseImageUrl } from "@/server/repositories/products-image";
import { productImageSrc } from "@/components/products/catalog-shared";
import { PRODUCT_READ_PERMISSIONS, LISTING_READ_PERMISSIONS } from "@/lib/grid-defs/products/permissions";
import { DEFAULT_ROLE_PERMISSIONS } from "@/server/auth/permission-catalog";

describe("product image proxy: URL validation (SSRF)", () => {
  it("accepts public http(s) CDN URLs", () => {
    expect(parseImageUrl("https://cdn.shopify.com/s/files/1/a.jpg").hostname).toBe("cdn.shopify.com");
    expect(parseImageUrl("http://m.media-amazon.com/images/I/x.png").protocol).toBe("http:");
  });
  it.each([
    "ftp://example.com/a.png", "file:///etc/passwd", "javascript:alert(1)", "not a url",
    "https://user:pw@example.com/a.png", "https://example.com:8080/a.png",
    "http://localhost/a.png", "http://foo.localhost/a.png", "http://printer.local/a.png", "http://metadata.internal/x",
    "http://127.0.0.1/a.png", "http://10.0.0.5/a.png", "http://169.254.169.254/latest/meta-data", "http://192.168.1.1/a.png",
    "http://172.16.0.1/a.png", "http://[::1]/a.png", "http://[fd00::1]/a.png", "http://[::ffff:127.0.0.1]/a.png", "http://0.0.0.0/a.png",
  ])("rejects %s", (u) => {
    expect(() => parseImageUrl(u)).toThrow(ImageProxyError);
  });
  it("blocks private, loopback, link-local, CGNAT and multicast addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "100.64.0.1", "169.254.1.1", "172.31.255.255", "192.168.0.1", "224.0.0.1", "255.255.255.255", "::1", "fe80::1", "fc00::1", "::ffff:10.0.0.1"]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "151.101.1.1", "172.32.0.1", "2606:4700::1111"]) expect(isBlockedAddress(ip), ip).toBe(false);
  });
});

describe("product image proxy: cache", () => {
  afterEach(() => clearProductImageCache());
  it("de-duplicates concurrent fetches and caches the result", async () => {
    const fetcher = vi.fn(async () => ({ contentType: "image/png", bytes: Buffer.from([1, 2, 3]) }));
    const [a, b] = await Promise.all([getProductImage("https://x.test/a.png", fetcher), getProductImage("https://x.test/a.png", fetcher)]);
    await getProductImage("https://x.test/a.png", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(a.bytes.equals(b.bytes)).toBe(true);
  });
  it("does not cache failures", async () => {
    const fetcher = vi.fn(async () => {
      throw new ImageProxyError(404, "nope");
    });
    await expect(getProductImage("https://x.test/b.png", fetcher)).rejects.toThrow("nope");
    await expect(getProductImage("https://x.test/b.png", fetcher)).rejects.toThrow("nope");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("productImageSrc", () => {
  it("routes remote URLs through the same-origin proxy", () => {
    expect(productImageSrc("https://picsum.photos/200")).toBe(`/api/products/image?u=${encodeURIComponent("https://picsum.photos/200")}`);
    expect(productImageSrc("/api/files/abc?inline=1")).toBe("/api/files/abc?inline=1");
    expect(productImageSrc("")).toBeNull();
    expect(productImageSrc("javascript:alert(1)")).toBeNull();
  });
});

describe("catalog read access", () => {
  it("operator and viewer can read products and listings by default; mutations stay gated", () => {
    for (const role of ["operator", "viewer"] as const) {
      const granted = new Set(DEFAULT_ROLE_PERMISSIONS[role]);
      expect(PRODUCT_READ_PERMISSIONS.some((k) => granted.has(k)), role).toBe(true);
      expect(LISTING_READ_PERMISSIONS.some((k) => granted.has(k)), role).toBe(true);
      expect(granted.has("settings.products.create")).toBe(false);
      expect(granted.has("settings.products.edit")).toBe(false);
    }
  });
});
