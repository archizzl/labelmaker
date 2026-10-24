/*
 * Inventory rules, kept free of the database so they can be tested on their own.
 */

export const MOVE_REASONS = [
  { key: "received", label: "Received", sign: 1 },
  { key: "sold", label: "Sold (shows, in person)", sign: -1 },
  { key: "used", label: "Used up", sign: -1 },
  { key: "given", label: "Given away", sign: -1 },
  { key: "damaged", label: "Damaged or lost", sign: -1 },
  { key: "recount", label: "Recount (set the count)", sign: 0 },
  { key: "other", label: "Other", sign: 0 },
] as const;

export type MoveReason = (typeof MOVE_REASONS)[number]["key"];

export const isMoveReason = (s: string): s is MoveReason => MOVE_REASONS.some((r) => r.key === s);

/**
 * What a move does to the count. Received adds; sold, used, given and damaged take away (whatever
 * sign was typed); a recount sets the count; other applies the amount as typed (+ or −). The count
 * never goes below zero.
 */
export function applyMove(onHand: number, reason: MoveReason, amount: number): { delta: number; onHandAfter: number } {
  const n = Math.trunc(amount);
  const sign = MOVE_REASONS.find((r) => r.key === reason)!.sign;
  const target = reason === "recount" ? Math.max(0, n) : Math.max(0, onHand + (sign === 0 ? n : sign * Math.abs(n)));
  return { delta: target - onHand, onHandAfter: target };
}

export const isLow = (item: { onHand: number; lowAt: number | null }) => item.lowAt !== null && item.onHand <= item.lowAt;

type Package = { bandcampId: number; title: string; sku: string | null; options?: { title: string; sku: string | null }[] };
type CatalogRelease = { id: number; title: string; kind: "album" | "track" | "merch"; bandId: number; packages: Package[] };
export type Candidate = { name: string; bandId: number; releaseId: number; packageId: number | null; option: string | null; sku: string | null };

/**
 * Every format and merch item in the catalog (one per size or colour) that isn't tracked yet, to
 * add in one go. Matched on the catalog item, package and option, so running it again adds only
 * what's new.
 */
export function catalogCandidates(
  releases: CatalogRelease[],
  tracked: { releaseId: number | null; packageId: number | null; option: string | null }[],
): Candidate[] {
  const key = (releaseId: number | null, packageId: number | null, option: string | null) => `${releaseId}|${packageId ?? ""}|${(option ?? "").toLowerCase()}`;
  const have = new Set(tracked.map((t) => key(t.releaseId, t.packageId, t.option)));
  const out: Candidate[] = [];
  for (const r of releases) {
    for (const p of r.packages) {
      const name = r.kind === "merch" || p.title.toLowerCase().includes(r.title.toLowerCase()) ? p.title : `${r.title} — ${p.title}`;
      const variants = p.options?.length ? p.options.map((o) => ({ option: o.title, sku: o.sku ?? p.sku })) : [{ option: null, sku: p.sku }];
      for (const v of variants) {
        if (have.has(key(r.id, p.bandcampId, v.option))) continue;
        have.add(key(r.id, p.bandcampId, v.option));
        out.push({ name, bandId: r.bandId, releaseId: r.id, packageId: p.bandcampId, option: v.option, sku: v.sku });
      }
    }
  }
  return out;
}

type Tracked = { id: number; releaseId: number | null; packageId: number | null; option: string | null; sku: string | null; createdAt: string };
export type OnlineSale = { date: string; category: string; itemType: string; netCents: number; releaseId: number | null; packageName: string; raw: Record<string, string> };

/**
 * The tracked item a sale from Bandcamp is stock of, if it's clearly one: by its SKU, or else by its
 * catalog item, format and size or colour. Refunds don't count (what was refunded may not come
 * back), and nor does anything sold before the item was tracked (its count already allows for it).
 */
export function stockForSale(sale: OnlineSale, items: Tracked[], packagesOf: (releaseId: number) => { bandcampId: number; title: string }[]): number | null {
  if (sale.category !== "merch" || sale.netCents < 0 || sale.itemType.includes("refund")) return null;
  const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
  const option = sale.raw.option ?? null;
  const live = items.filter((i) => sale.date >= i.createdAt.slice(0, 10));
  // Several sizes can share a SKU: then the size decides.
  const pick = (found: Tracked[]) => (found.length > 1 ? found.filter((i) => same(i.option, option)) : found);
  const sku = sale.raw.sku?.trim();
  if (sku) {
    const bySku = pick(live.filter((i) => i.sku && same(i.sku, sku)));
    if (bySku.length === 1) return bySku[0].id;
    if (bySku.length > 1) return null;
  }
  if (sale.releaseId === null) return null;
  let found = live.filter((i) => i.releaseId === sale.releaseId);
  const pkg = packagesOf(sale.releaseId).find((p) => same(p.title, sale.packageName));
  if (pkg) found = found.filter((i) => i.packageId === null || i.packageId === pkg.bandcampId);
  else if (new Set(found.map((i) => i.packageId)).size > 1) return null;
  found = found.filter((i) => same(i.option, option));
  return found.length === 1 ? found[0].id : null;
}
