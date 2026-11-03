import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { newAccount, testDb } from "../../../test/helpers/db";
import type { Context } from "../context";

let db: Awaited<ReturnType<typeof testDb>>["db"];
let schema: Awaited<ReturnType<typeof testDb>>["schema"];
let context: typeof import("../context");

beforeAll(async () => {
  ({ db, schema } = await testDb());
  context = await import("../context");
});

async function login(orgId: string, role: "owner" | "admin" | "member") {
  const id = randomUUID();
  await db.insert(schema.user).values({ id, name: role, email: `${id}@example.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
  await db.insert(schema.member).values({ id: randomUUID(), organizationId: orgId, userId: id, role, createdAt: new Date() });
  return id;
}
const as = (orgId: string, role: "owner" | "admin" | "member", managedBy: Context["managedBy"] = null) =>
  ({ orgId, org: { role }, isAdmin: role !== "member", managedBy }) as unknown as Context;

describe("who may delete a group", () => {
  it("is its owner, or any admin once the owner has left", async () => {
    const orgId = await newAccount();
    await login(orgId, "owner");
    await login(orgId, "admin");
    expect(await context.mayDeleteGroup(as(orgId, "owner"))).toBe(true);
    expect(await context.mayDeleteGroup(as(orgId, "admin"))).toBe(false);
    expect(await context.mayDeleteGroup(as(orgId, "member"))).toBe(false);

    const ownerless = await newAccount();
    await login(ownerless, "admin");
    expect(await context.mayDeleteGroup(as(ownerless, "admin"))).toBe(true);
    expect(await context.mayDeleteGroup(as(ownerless, "member"))).toBe(false);
  });

  it("is never a band account the label made", async () => {
    const orgId = await newAccount("Flag Day", "band");
    expect(await context.mayDeleteGroup(as(orgId, "owner", { linkId: 1, labelOrgId: "x", labelName: "Label", bandId: 1, ownBooks: true }))).toBe(false);
  });
});
