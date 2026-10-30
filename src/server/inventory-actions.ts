"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { applyMove, catalogCandidates, isMoveReason } from "@/lib/inventory";
import { parseCents } from "@/lib/money";
import { bandScope } from "@/lib/permissions";
import { type Context, requireAccess } from "./context";
import { deleteMerchPhoto, merchPhotoUrl, ownPhotoId, photoFrom, saveMerchPhoto } from "./merch-photos";

/*
 * Inventory: adding and changing items, and their counts. Anyone who can change Inventory; members
 * limited to their own bands only touch those bands' items (and must pick one of their bands).
 */

export type InventoryState = { ok?: string; error?: string } | null;

const { inventoryItems, inventoryMoves, releases, bands } = schema;
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const optInt = (fd: FormData, k: string) => {
  const v = str(fd, k);
  return v === "" || !Number.isFinite(Number(v)) ? null : Math.trunc(Number(v));
};

/** The bands this person may file items under, or null for any. */
const scopeOf = (ctx: Context) => bandScope(ctx.access, "inventory");

/** An item in this account that this person may change. */
async function ownItem(ctx: Context, id: number) {
  const [item] = await db
    .select()
    .from(inventoryItems)
    .where(and(eq(inventoryItems.orgId, ctx.orgId), eq(inventoryItems.id, id)));
  const scope = scopeOf(ctx);
  if (!item || (scope && (item.bandId === null || !scope.includes(item.bandId)))) throw new Error("That item isn’t in your inventory.");
  return item;
}

function done() {
  revalidatePath("/inventory");
  revalidatePath("/");
}

/**
 * Give an item a photo (`file`), or take its uploaded one off (null). Stock outside the catalog keeps
 * its own; stock of a catalog item without a photo from Bandcamp puts it on the catalog item, so it
 * shows everywhere that item does. A photo from Bandcamp stays.
 */
async function setItemPhoto(orgId: string, item: { id: number; releaseId: number | null; photoId: number | null }, file: File | null) {
  if (item.releaseId) {
    const [r] = await db
      .select({ id: releases.id, artUrl: releases.artUrl })
      .from(releases)
      .where(and(eq(releases.orgId, orgId), eq(releases.id, item.releaseId)));
    if (!r) return;
    if (r.artUrl && !ownPhotoId(r.artUrl)) throw new Error("It has a photo from Bandcamp.");
    const photoId = file ? await saveMerchPhoto(orgId, file) : null;
    await db.update(releases).set({ artUrl: photoId ? merchPhotoUrl(photoId) : null }).where(eq(releases.id, r.id));
    await deleteMerchPhoto(orgId, ownPhotoId(r.artUrl));
    // (One it had of its own, from before it was linked, isn't shown any more.)
    if (item.photoId) {
      await db.update(inventoryItems).set({ photoId: null }).where(eq(inventoryItems.id, item.id));
      await deleteMerchPhoto(orgId, item.photoId);
    }
    return;
  }
  const photoId = file ? await saveMerchPhoto(orgId, file) : null;
  await db.update(inventoryItems).set({ photoId }).where(eq(inventoryItems.id, item.id));
  await deleteMerchPhoto(orgId, item.photoId);
}

/** Upload a photo for an item (from its picture on the Inventory page), or with "remove", take it off. */
export async function setInventoryPhoto(_: InventoryState, fd: FormData): Promise<InventoryState> {
  const ctx = await requireAccess("inventory", "edit");
  try {
    const item = await ownItem(ctx, optInt(fd, "id") ?? -1);
    const file = str(fd, "remove") === "1" ? null : photoFrom(fd);
    if (!file && str(fd, "remove") !== "1") return { error: "Choose a photo." };
    await setItemPhoto(ctx.orgId, item, file);
    revalidatePath("/", "layout");
    return { ok: file ? "Photo saved." : "Photo removed." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Add an item, or change its details (not its count: that's adjustInventory). */
export async function saveInventoryItem(_: InventoryState, fd: FormData): Promise<InventoryState> {
  const ctx = await requireAccess("inventory", "edit");
  const { orgId } = ctx;
  try {
    const id = optInt(fd, "id");
    const name = str(fd, "name").slice(0, 200);
    if (!name) return { error: "Give it a name." };
    const kind = str(fd, "kind") === "supply" ? "supply" : "product";
    let bandId = optInt(fd, "bandId");
    // "Which catalog item": "releaseId:packageId" (packageId may be empty for the release itself).
    const [rel, pkg] = str(fd, "catalog").split(":");
    let releaseId = rel ? Number(rel) || null : null;
    let packageId = pkg ? Number(pkg) || null : null;
    if (releaseId) {
      const [r] = await db
        .select({ bandId: releases.bandId, packages: releases.packages })
        .from(releases)
        .where(and(eq(releases.orgId, orgId), eq(releases.id, releaseId)));
      if (!r) return { error: "That catalog item isn’t in this group." };
      if (packageId && !r.packages.some((p) => p.bandcampId === packageId)) packageId = null;
      bandId = r.bandId; // stock of a release belongs to its band
    } else {
      releaseId = null;
      packageId = null;
    }
    if (bandId !== null) {
      const [b] = await db.select({ id: bands.id }).from(bands).where(and(eq(bands.orgId, orgId), eq(bands.id, bandId)));
      if (!b) return { error: "That band isn’t in this group." };
    }
    const scope = scopeOf(ctx);
    if (scope && (bandId === null || !scope.includes(bandId))) return { error: "Choose one of your bands." };
    const lowAt = optInt(fd, "lowAt");
    const desired = optInt(fd, "desired");
    const cost = str(fd, "unitCost");
    const price = str(fd, "price");
    const values = {
      kind: kind as "product" | "supply",
      name,
      bandId,
      releaseId,
      packageId,
      option: str(fd, "option").slice(0, 100) || null,
      sku: str(fd, "sku").slice(0, 100) || null,
      lowAt: lowAt !== null && lowAt >= 0 ? lowAt : null,
      desired: desired !== null && desired > 0 ? desired : null,
      unitCostCents: cost ? parseCents(cost) : null,
      // (Supplies aren't sold.)
      priceCents: price && kind === "product" ? parseCents(price) : null,
      currency: (str(fd, "currency") || "USD").toUpperCase().slice(0, 3),
      location: str(fd, "location").slice(0, 200) || null,
      notes: str(fd, "notes").slice(0, 1000) || null,
    };
    // Its photo (see setItemPhoto), once the item is saved: a new one, or the uploaded one taken off.
    const before = id ? await ownItem(ctx, id) : null;
    const file = photoFrom(fd);
    let itemId = id;
    if (id) {
      // Linked to a catalog item now: it shows the catalog's photo, so one of its own goes.
      const dropOwn = !!releaseId && !!before?.photoId;
      await db
        .update(inventoryItems)
        .set({ ...values, ...(dropOwn ? { photoId: null } : {}) })
        .where(eq(inventoryItems.id, id));
      if (dropOwn) await deleteMerchPhoto(orgId, before!.photoId);
    } else {
      const start = Math.max(0, optInt(fd, "onHand") ?? 0);
      itemId = await db.transaction(async (tx) => {
        const [item] = await tx.insert(inventoryItems).values({ ...values, orgId, onHand: start }).returning({ id: inventoryItems.id });
        if (start) {
          await tx.insert(inventoryMoves).values({ orgId, itemId: item.id, delta: start, reason: "recount", note: "Starting count", onHandAfter: start, byUserId: ctx.user.id });
        }
        return item.id;
      });
    }
    if (file || str(fd, "removePhoto") === "1") {
      const [saved] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, itemId!));
      await setItemPhoto(orgId, saved, file);
    }
    done();
    return { ok: id ? `Saved ${name}.` : `Added ${name}.` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Change an item's count (received, used, sold, recount…), keeping a record of it. */
export async function adjustInventory(_: InventoryState, fd: FormData): Promise<InventoryState> {
  // A band's own account can recount its band's stock (nothing else in inventory).
  const ctx = await requireAccess("inventory", "edit", { bandMay: true });
  try {
    const item = await ownItem(ctx, optInt(fd, "id") ?? -1);
    const reason = str(fd, "reason");
    if (!isMoveReason(reason)) return { error: "Choose what happened." };
    const amount = optInt(fd, "amount");
    if (amount === null || (reason !== "recount" && amount === 0)) return { error: reason === "recount" ? "Enter the count." : "Enter how many." };
    let after = 0;
    await db.transaction(async (tx) => {
      // The count as it is now (someone else may have just changed it).
      const [cur] = await tx.select({ onHand: inventoryItems.onHand }).from(inventoryItems).where(eq(inventoryItems.id, item.id)).for("update");
      const { delta, onHandAfter } = applyMove(cur.onHand, reason, amount);
      after = onHandAfter;
      await tx.update(inventoryItems).set({ onHand: onHandAfter }).where(eq(inventoryItems.id, item.id));
      await tx.insert(inventoryMoves).values({
        orgId: ctx.orgId,
        itemId: item.id,
        delta,
        reason,
        note: str(fd, "note").slice(0, 300) || null,
        onHandAfter,
        byUserId: ctx.user.id,
      });
    });
    done();
    return { ok: `${item.name}${item.option ? ` (${item.option})` : ""}: ${after} on hand.` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Take an item off the list (its history is kept). */
export async function archiveInventoryItem(fd: FormData) {
  const ctx = await requireAccess("inventory", "edit");
  const item = await ownItem(ctx, optInt(fd, "id") ?? -1);
  await db.update(inventoryItems).set({ archived: true }).where(eq(inventoryItems.id, item.id));
  done();
}

/** Add every format and merch item from the catalog that isn't tracked yet (counts start at 0). */
export async function addFromCatalog(_: InventoryState, fd: FormData): Promise<InventoryState> {
  const ctx = await requireAccess("inventory", "edit");
  const { orgId } = ctx;
  const scope = scopeOf(ctx);
  const onlyBand = optInt(fd, "bandId");
  const bandFilter = scope ?? (onlyBand ? [onlyBand] : null);
  const rel = await db
    .select({ id: releases.id, title: releases.title, kind: releases.kind, bandId: releases.bandId, packages: releases.packages })
    .from(releases)
    .where(and(eq(releases.orgId, orgId), bandFilter ? inArray(releases.bandId, bandFilter.length ? bandFilter : [-1]) : undefined));
  const tracked = await db
    .select({ releaseId: inventoryItems.releaseId, packageId: inventoryItems.packageId, option: inventoryItems.option })
    .from(inventoryItems)
    .where(eq(inventoryItems.orgId, orgId));
  const add = catalogCandidates(rel, tracked);
  if (!add.length) return { ok: "Everything in the catalog is already here." };
  await db.insert(inventoryItems).values(add.map((c) => ({ ...c, orgId, kind: "product" as const, onHand: 0 })));
  done();
  return { ok: `Added ${add.length} item${add.length === 1 ? "" : "s"} from the catalog, at 0 on hand. Count them in with “Received” or “Recount”.` };
}
