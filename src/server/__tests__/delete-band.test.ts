import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { newAccount, testDb } from "../../../test/helpers/db";

let orgId = "";
const label = () => ({
  orgId,
  org: { id: orgId, kind: "label" },
  lens: false,
  ownLogin: false,
  books: "label",
  user: { id: "u1" },
  access: { admin: true, permissions: {}, bandAreas: [], bandIds: [] },
});
vi.mock("../context", () => ({
  getContext: async () => label(),
  requireAccess: async () => label(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));

let db: Awaited<ReturnType<typeof testDb>>["db"];
let schema: Awaited<ReturnType<typeof testDb>>["schema"];
let actions: typeof import("../actions");

beforeAll(async () => {
  ({ db, schema } = await testDb());
  actions = await import("../actions");
  orgId = await newAccount("Label");
});

const form = (values: Record<string, string | number>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, String(v));
  return fd;
};
const exists = async (id: number) => (await db.select().from(schema.bands).where(eq(schema.bands.id, id))).length > 0;

describe("deleting a band", () => {
  it("needs the band's name typed to confirm", async () => {
    const [band] = await db.insert(schema.bands).values({ orgId, name: "Flag Day" }).returning();
    expect(await actions.deleteBandForm(null, form({ id: band.id }))).toEqual({ error: "Type Flag Day exactly to confirm." });
    expect(await actions.deleteBandForm(null, form({ id: band.id, name: "Flag" }))).toEqual({ error: "Type Flag Day exactly to confirm." });
    expect(await exists(band.id)).toBe(true);
  });

  it("deletes it once the name matches, ignoring case and spaces around it", async () => {
    const [band] = await db.insert(schema.bands).values({ orgId, name: "Sweetums" }).returning();
    await expect(actions.deleteBand(form({ id: band.id, name: "  sweetUMS " }))).rejects.toThrow("redirect /directory");
    expect(await exists(band.id)).toBe(false);
  });
});
