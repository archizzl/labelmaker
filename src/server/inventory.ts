import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { applyMove, type MoveReason, type OnlineSale, stockForSale } from "@/lib/inventory";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Change an item's count as part of something else (a sale, or taking one back), the
 * way a change on the Inventory page does: under a lock, never below zero, and kept in its history.
 * Returns how much it actually changed.
 */
export async function takeStock(
  tx: Tx,
  item: { id: number; orgId: string },
  reason: MoveReason,
  amount: number,
  { saleId, userId, note }: { saleId: number | null; userId: string | null; note: string },
) {
  const [cur] = await tx
    .select({ onHand: schema.inventoryItems.onHand })
    .from(schema.inventoryItems)
    .where(eq(schema.inventoryItems.id, item.id))
    .for("update");
  // (Archived or gone since: nothing to change.)
  if (!cur) return 0;
  const { delta, onHandAfter } = applyMove(cur.onHand, reason, amount);
  if (!delta) return 0;
  await tx.update(schema.inventoryItems).set({ onHand: onHandAfter }).where(eq(schema.inventoryItems.id, item.id));
  await tx.insert(schema.inventoryMoves).values({ orgId: item.orgId, itemId: item.id, delta, reason, note, onHandAfter, byUserId: userId, saleId });
  return delta;
}

/** New sales from Bandcamp come off the stock they're of (see stockForSale), each linked to its sale. */
export async function takeOnlineSales(tx: Tx, orgId: string, sold: (OnlineSale & { id: number; quantity: number })[]) {
  const merch = sold.filter((s) => s.category === "merch" && s.netCents >= 0);
  if (!merch.length) return;
  const items = await tx
    .select({
      id: schema.inventoryItems.id,
      releaseId: schema.inventoryItems.releaseId,
      packageId: schema.inventoryItems.packageId,
      option: schema.inventoryItems.option,
      sku: schema.inventoryItems.sku,
      createdAt: schema.inventoryItems.createdAt,
    })
    .from(schema.inventoryItems)
    .where(and(eq(schema.inventoryItems.orgId, orgId), eq(schema.inventoryItems.kind, "product"), eq(schema.inventoryItems.archived, false)));
  if (!items.length) return;
  const releaseIds = [...new Set(merch.map((s) => s.releaseId).filter((r): r is number => r !== null))];
  const packages = new Map(
    releaseIds.length
      ? (
          await tx
            .select({ id: schema.releases.id, packages: schema.releases.packages })
            .from(schema.releases)
            .where(and(eq(schema.releases.orgId, orgId), inArray(schema.releases.id, releaseIds)))
        ).map((r) => [r.id, r.packages])
      : [],
  );
  for (const s of merch) {
    const itemId = stockForSale(s, items, (r) => packages.get(r) ?? []);
    if (itemId !== null) await takeStock(tx, { id: itemId, orgId }, "sold", Math.max(1, s.quantity), { saleId: s.id, userId: null, note: `From a Bandcamp sale on ${s.date}` });
  }
}

/** Put back what these sales took off stock, before they're deleted. */
export async function putBackStock(tx: Tx, saleIds: number[], userId: string | null) {
  if (!saleIds.length) return;
  const moves = await tx.select().from(schema.inventoryMoves).where(inArray(schema.inventoryMoves.saleId, saleIds));
  for (const m of moves) {
    await takeStock(tx, { id: m.itemId, orgId: m.orgId }, "other", -m.delta, { saleId: null, userId, note: "Back in stock: the sale was deleted" });
  }
}
