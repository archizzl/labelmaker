import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ReleaseDetails } from "@/lib/bandcamp-release";
import { newAccount, testDb } from "../../../test/helpers/db";

let orgId = "";
let testUser = "";
const ctx = () => ({ orgId, managedBy: null, person: null, lens: false, access: { admin: true, permissions: {}, bandAreas: [], bandIds: [] }, user: { id: testUser, name: "Tester" } });
vi.mock("../context", () => ({
  requireAccess: async () => ctx(),
  getContext: async () => ctx(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let db: Awaited<ReturnType<typeof testDb>>["db"];
let schema: Awaited<ReturnType<typeof testDb>>["schema"];
let inventory: typeof import("../inventory-actions");
let photos: typeof import("../merch-photo-actions");
let bandcamp: typeof import("../bandcamp");

beforeAll(async () => {
  ({ db, schema } = await testDb());
  testUser = randomUUID();
  await db.insert(schema.user).values({ id: testUser, name: "Tester", email: `${testUser}@example.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
  inventory = await import("../inventory-actions");
  photos = await import("../merch-photo-actions");
  bandcamp = await import("../bandcamp");
});

const photo = (name = "tote.png") => new File([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], name, { type: "image/png" });
const form = (values: Record<string, string | number | File>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v instanceof File ? v : String(v));
  return fd;
};
const photoRows = () => db.select().from(schema.merchPhotos).where(eq(schema.merchPhotos.orgId, orgId));

describe("merch photos", () => {
  it("keeps a photo for stock outside the catalog, replaces it, and removes it", async () => {
    orgId = await newAccount("Label");
    expect(await inventory.saveInventoryItem(null, form({ name: "Tote bag", kind: "product", photo: photo() }))).toEqual({ ok: "Added Tote bag." });
    const [item] = await db.select().from(schema.inventoryItems).where(eq(schema.inventoryItems.orgId, orgId));
    const [first] = await photoRows();
    expect(item.photoId).toBe(first.id);
    expect(first).toMatchObject({ contentType: "image/png", size: 7, storageKey: null });

    // A new one replaces it (the old one's gone), then it's taken off.
    await inventory.saveInventoryItem(null, form({ id: item.id, name: "Tote bag", kind: "product", photo: photo("new.png") }));
    const [second] = await photoRows();
    expect(second.id).not.toBe(first.id);
    await inventory.saveInventoryItem(null, form({ id: item.id, name: "Tote bag", kind: "product", removePhoto: "1" }));
    expect(await photoRows()).toEqual([]);

    const notAPhoto = new File(["x"], "list.pdf", { type: "application/pdf" });
    expect(await inventory.saveInventoryItem(null, form({ name: "Poster", kind: "product", photo: notAPhoto }))).toEqual({ error: "The photo must be a JPEG, PNG, GIF or WebP." });
  });

  it("puts one on a catalog item without a Bandcamp photo, and keeps it until Bandcamp has one", async () => {
    orgId = await newAccount("Label");
    const [band] = await db.insert(schema.bands).values({ orgId, name: "Flag Day" }).returning();
    const [shirt] = await db.insert(schema.releases).values({ orgId, bandId: band.id, title: "Logo Shirt", kind: "merch", bandcampId: 77 }).returning();
    const [fromBandcamp] = await db.insert(schema.releases).values({ orgId, bandId: band.id, title: "Hat", kind: "merch", artUrl: "https://f4.bcbits.com/img/1_10.jpg" }).returning();

    expect(await photos.setReleasePhoto(null, form({ id: fromBandcamp.id, photo: photo() }))).toEqual({ error: "It has a photo from Bandcamp." });
    expect(await photos.setReleasePhoto(null, form({ id: shirt.id, photo: photo() }))).toEqual({ ok: "Photo saved." });
    const [p] = await photoRows();
    const artOf = async () => (await db.select().from(schema.releases).where(eq(schema.releases.id, shirt.id)))[0].artUrl;
    expect(await artOf()).toBe(`/merch/photo/${p.id}`);

    const details = (artUrl: string | null): ReleaseDetails => ({
      bandcampId: 77,
      kind: "merch",
      title: "Logo Shirt",
      artist: null,
      url: "",
      releaseDate: null,
      upc: null,
      catalogNumber: null,
      about: null,
      credits: null,
      tags: [],
      artUrl,
      packages: [],
      tracks: [],
    });
    await bandcamp.upsertRelease(orgId, details(null), band.id, shirt.id);
    expect(await artOf()).toBe(`/merch/photo/${p.id}`);
    await bandcamp.upsertRelease(orgId, details("https://f4.bcbits.com/img/2_10.jpg"), band.id, shirt.id);
    expect(await artOf()).toBe("https://f4.bcbits.com/img/2_10.jpg");
  });

  it("from the Inventory page: stock of a catalog item without a Bandcamp photo gives the catalog item one", async () => {
    orgId = await newAccount("Label");
    const [band] = await db.insert(schema.bands).values({ orgId, name: "Flag Day" }).returning();
    const [handMade] = await db.insert(schema.releases).values({ orgId, bandId: band.id, title: "Patch", kind: "merch" }).returning();
    const [fromBandcamp] = await db
      .insert(schema.releases)
      .values({ orgId, bandId: band.id, title: "Shirt", kind: "merch", artUrl: "https://f4.bcbits.com/img/0001_10.jpg" })
      .returning();
    const [patch, shirt, loose] = await db
      .insert(schema.inventoryItems)
      .values([
        { orgId, name: "Patch", kind: "product", bandId: band.id, releaseId: handMade.id },
        { orgId, name: "Shirt", kind: "product", bandId: band.id, releaseId: fromBandcamp.id },
        { orgId, name: "Sticker", kind: "product" },
      ])
      .returning();

    expect(await inventory.setInventoryPhoto(null, form({ id: patch.id, photo: photo() }))).toEqual({ ok: "Photo saved." });
    const [r] = await db.select().from(schema.releases).where(eq(schema.releases.id, handMade.id));
    expect(r.artUrl).toMatch(/^\/merch\/photo\/\d+$/);
    expect(await inventory.setInventoryPhoto(null, form({ id: shirt.id, photo: photo() }))).toEqual({ error: "It has a photo from Bandcamp." });
    expect(await inventory.setInventoryPhoto(null, form({ id: loose.id, photo: photo() }))).toEqual({ ok: "Photo saved." });
    expect((await db.select().from(schema.inventoryItems).where(eq(schema.inventoryItems.id, loose.id)))[0].photoId).not.toBeNull();

    // Taken off again: the catalog item has none, and its file is gone.
    expect(await inventory.setInventoryPhoto(null, form({ id: patch.id, remove: "1" }))).toEqual({ ok: "Photo removed." });
    expect((await db.select().from(schema.releases).where(eq(schema.releases.id, handMade.id)))[0].artUrl).toBeNull();
    expect(await photoRows()).toHaveLength(1);
  });

  it("keeps how many of an item they'd like to have, or none", async () => {
    orgId = await newAccount("Label");
    await inventory.saveInventoryItem(null, form({ name: "Poster", kind: "product", onHand: 2, desired: 6 }));
    const [item] = await db.select().from(schema.inventoryItems).where(eq(schema.inventoryItems.orgId, orgId));
    expect(item).toMatchObject({ onHand: 2, desired: 6 });
    await inventory.saveInventoryItem(null, form({ id: item.id, name: "Poster", kind: "product", desired: "" }));
    expect((await db.select().from(schema.inventoryItems).where(eq(schema.inventoryItems.id, item.id)))[0].desired).toBeNull();
  });
});
