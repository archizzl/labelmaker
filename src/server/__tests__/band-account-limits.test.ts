import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { newAccount, testDb } from "../../../test/helpers/db";

// What a band account the label made may not change in the label's books: what sales are matched
// by, and where people are paid. The label (asLens = false) still can.
let labelOrgId = "";
let ownOrgId = "";
let bandId = 0;
let asLens = true;
const lens = () => ({
  orgId: labelOrgId,
  org: { id: labelOrgId, kind: "label" },
  lens: true,
  ownLogin: false,
  books: "label",
  user: { id: "u1" },
  managedBy: { linkId: 1, labelOrgId, labelName: "Label", bandId, ownBooks: true },
  access: { admin: false, permissions: { roster: "edit" }, bandAreas: ["roster"], bandIds: [bandId] },
});
const label = () => ({
  orgId: labelOrgId,
  org: { id: labelOrgId, kind: "label" },
  lens: false,
  user: { id: "u1" },
  access: { admin: true, permissions: {}, bandAreas: [], bandIds: [] },
});
vi.mock("../context", () => ({
  getContext: async () => (asLens ? lens() : label()),
  requireAccess: async () => (asLens ? lens() : label()),
  requireAdmin: async () => ({ orgId: ownOrgId, org: { id: ownOrgId, kind: "band" }, managedBy: lens().managedBy, user: { id: "u1" } }),
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
let accountActions: typeof import("../account-actions");

beforeAll(async () => {
  ({ db, schema } = await testDb());
  actions = await import("../actions");
  accountActions = await import("../account-actions");
  labelOrgId = await newAccount("Label");
  ownOrgId = await newAccount("Flag Day", "band");
  const [band] = await db.insert(schema.bands).values({ orgId: labelOrgId, name: "Flag Day", aliases: ["Flagday"], urlPatterns: ["flagday.bandcamp.com"] }).returning();
  bandId = band.id;
});

const form = (values: Record<string, string | number>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, String(v));
  return fd;
};
const theBand = async () => (await db.select().from(schema.bands).where(eq(schema.bands.id, bandId)))[0];

describe("a band account and what sales are matched by", () => {
  it("keeps the label's spellings and addresses, and its old name when it renames itself", async () => {
    asLens = true;
    await actions.saveBand(form({ id: bandId, name: "Flag Night", aliases: "Anything", urlPatterns: "someone-else.bandcamp.com" }));
    expect(await theBand()).toMatchObject({ name: "Flag Night", aliases: ["Flagday", "Flag Day"], urlPatterns: ["flagday.bandcamp.com"] });

    // From its Settings too.
    expect(await accountActions.saveBandSettings(null, form({ name: "Flag Night", aliases: "Anything", bandcampUrl: "someone-else.bandcamp.com" }))).toEqual({ ok: "Saved" });
    expect(await theBand()).toMatchObject({ aliases: ["Flagday", "Flag Day"], urlPatterns: ["flagday.bandcamp.com"] });

    asLens = false;
    await actions.saveBand(form({ id: bandId, name: "Flag Day", aliases: "Flagday", urlPatterns: "flagday.bandcamp.com, flag-day.bandcamp.com" }));
    expect(await theBand()).toMatchObject({ name: "Flag Day", aliases: ["Flagday"], urlPatterns: ["flagday.bandcamp.com", "flag-day.bandcamp.com"] });
  });
});

describe("a band account and where people are paid", () => {
  it("can't set or change anyone's payment details", async () => {
    const [alex] = await db.insert(schema.people).values({ orgId: labelOrgId, name: "Alex", email: "alex@example.test", venmo: "alex" }).returning();
    const [m] = await db.insert(schema.bandMemberships).values({ orgId: labelOrgId, bandId, personId: alex.id, roles: [] }).returning();
    const refused = "Only the person (on their Account page) or the label can change where they’re paid.";
    asLens = true;

    // Its name, yes (the form has no payment fields for it).
    await actions.savePerson(form({ id: alex.id, name: "Alex K" }));
    await expect(actions.savePerson(form({ id: alex.id, name: "Alex K", email: "band@example.test" }))).rejects.toThrow(refused);
    await expect(actions.updateMembership(form({ membershipId: m.id, name: "Alex K", venmo: "@band", active: "on" }))).rejects.toThrow(refused);
    // Abel sends the current values back: no change, no error.
    await actions.updateMembership(form({ membershipId: m.id, name: "Alex K", email: "alex@example.test", venmo: "alex", paypalMe: "", cashtag: "", active: "on" }));
    expect((await db.select().from(schema.people).where(eq(schema.people.id, alex.id)))[0]).toMatchObject({ name: "Alex K", email: "alex@example.test", venmo: "alex" });

    // Not for someone new either.
    await expect(actions.addMember(form({ bandId, name: "Sam", paypalMe: "sam" }))).rejects.toThrow(refused);

    asLens = false;
    await actions.savePerson(form({ id: alex.id, name: "Alex K", email: "alex2@example.test" }));
    expect((await db.select().from(schema.people).where(eq(schema.people.id, alex.id)))[0].email).toBe("alex2@example.test");
  });
});
