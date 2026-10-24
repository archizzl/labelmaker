import { describe, expect, it } from "vitest";
import { applyMove, catalogCandidates, isLow, type OnlineSale, stockForSale } from "../inventory";

describe("inventory counts", () => {
  it("received adds, used and sold take away whatever sign is typed, recount sets it", () => {
    expect(applyMove(10, "received", 5)).toEqual({ delta: 5, onHandAfter: 15 });
    expect(applyMove(10, "used", 3)).toEqual({ delta: -3, onHandAfter: 7 });
    expect(applyMove(10, "sold", -3)).toEqual({ delta: -3, onHandAfter: 7 });
    expect(applyMove(10, "recount", 4)).toEqual({ delta: -6, onHandAfter: 4 });
    expect(applyMove(10, "other", -2)).toEqual({ delta: -2, onHandAfter: 8 });
  });
  it("never goes below zero", () => {
    expect(applyMove(2, "damaged", 5)).toEqual({ delta: -2, onHandAfter: 0 });
    expect(applyMove(2, "recount", -1)).toEqual({ delta: -2, onHandAfter: 0 });
  });
  it("is low at or below its level, if it has one", () => {
    expect(isLow({ onHand: 3, lowAt: 3 })).toBe(true);
    expect(isLow({ onHand: 4, lowAt: 3 })).toBe(false);
    expect(isLow({ onHand: 0, lowAt: null })).toBe(false);
  });
});

describe("adding the catalog's items", () => {
  const releases = [
    { id: 1, title: "Flags of the World", kind: "album" as const, bandId: 7, packages: [{ bandcampId: 11, title: "Compact Disc", sku: "FD-CD" }] },
    { id: 2, title: "Logo Shirt", kind: "merch" as const, bandId: 7, packages: [{ bandcampId: 22, title: "Logo Shirt", sku: null, options: [{ title: "M", sku: "S-M" }, { title: "L", sku: null }] }] },
    { id: 3, title: "Digital only", kind: "album" as const, bandId: 7, packages: [] },
  ];
  it("adds one per format and per size, named sensibly", () => {
    expect(catalogCandidates(releases, [])).toEqual([
      { name: "Flags of the World — Compact Disc", bandId: 7, releaseId: 1, packageId: 11, option: null, sku: "FD-CD" },
      { name: "Logo Shirt", bandId: 7, releaseId: 2, packageId: 22, option: "M", sku: "S-M" },
      { name: "Logo Shirt", bandId: 7, releaseId: 2, packageId: 22, option: "L", sku: null },
    ]);
  });
  it("skips what's already tracked", () => {
    expect(catalogCandidates(releases, [{ releaseId: 2, packageId: 22, option: "m" }, { releaseId: 1, packageId: 11, option: null }]).map((c) => c.option)).toEqual(["L"]);
  });
});

describe("which stock a Bandcamp sale comes off", () => {
  const item = (id: number, x: { releaseId?: number | null; packageId?: number | null; option?: string | null; sku?: string | null; createdAt?: string }) => ({
    id,
    releaseId: x.releaseId ?? null,
    packageId: x.packageId ?? null,
    option: x.option ?? null,
    sku: x.sku ?? null,
    createdAt: x.createdAt ?? "2026-01-01 00:00:00",
  });
  const sale = (x: Partial<OnlineSale> = {}): OnlineSale => ({ date: "2026-05-01", category: "merch", itemType: "package", netCents: 1500, releaseId: 7, packageName: "CD", raw: {}, ...x });
  const packages = () => [
    { bandcampId: 1, title: "CD" },
    { bandcampId: 2, title: "Vinyl LP" },
  ];

  it("matches on SKU first, then the size when sizes share one", () => {
    const items = [item(1, { sku: "fd-cd" }), item(2, { sku: "TEE", option: "S" }), item(3, { sku: "TEE", option: "M" })];
    expect(stockForSale(sale({ raw: { sku: "FD-CD" } }), items, packages)).toBe(1);
    expect(stockForSale(sale({ raw: { sku: "TEE", option: "m" } }), items, packages)).toBe(3);
    expect(stockForSale(sale({ releaseId: null, raw: { sku: "TEE" } }), items, packages)).toBe(null);
  });
  it("otherwise matches the catalog item, its format and size", () => {
    const items = [item(1, { releaseId: 7, packageId: 1 }), item(2, { releaseId: 7, packageId: 2 }), item(3, { releaseId: 8, option: "S" }), item(4, { releaseId: 8, option: "L" })];
    expect(stockForSale(sale(), items, packages)).toBe(1);
    expect(stockForSale(sale({ packageName: "Vinyl LP" }), items, packages)).toBe(2);
    expect(stockForSale(sale({ packageName: "Cassette" }), items, packages)).toBe(null); // unclear which
    expect(stockForSale(sale({ releaseId: 8, packageName: "Logo Tee", raw: { option: "L" } }), items, () => [])).toBe(4);
    expect(stockForSale(sale({ releaseId: 8, packageName: "Logo Tee" }), items, () => [])).toBe(null);
  });
  it("leaves out refunds, downloads, and sales from before the item was tracked", () => {
    const items = [item(1, { releaseId: 7, packageId: 1, createdAt: "2026-05-01 12:00:00" })];
    expect(stockForSale(sale(), items, packages)).toBe(1);
    expect(stockForSale(sale({ date: "2026-04-30" }), items, packages)).toBe(null);
    expect(stockForSale(sale({ netCents: -1500 }), items, packages)).toBe(null);
    expect(stockForSale(sale({ itemType: "refund" }), items, packages)).toBe(null);
    expect(stockForSale(sale({ category: "album", itemType: "album" }), items, packages)).toBe(null);
  });
});
