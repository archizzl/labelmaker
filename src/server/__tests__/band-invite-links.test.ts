import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { newAccount, testDb } from "../../../test/helpers/db";

let db: Awaited<ReturnType<typeof testDb>>["db"];
let schema: Awaited<ReturnType<typeof testDb>>["schema"];
let links: typeof import("../band-invite-links");

beforeAll(async () => {
  ({ db, schema } = await testDb());
  links = await import("../band-invite-links");
});

describe("joining with a label's invite link", () => {
  it("offers only the people without a login whose email is the one signed in with", async () => {
    const orgId = await newAccount();
    const userId = randomUUID();
    await db.insert(schema.user).values({ id: userId, name: "Taken", email: `${userId}@example.test`, emailVerified: false, createdAt: new Date(), updatedAt: new Date() });
    const [alex] = await db.insert(schema.people).values({ orgId, name: "Alex Klint", email: "Alex@Example.test " }).returning();
    await db.insert(schema.people).values({ orgId, name: "Billy Hessler", email: "billy@example.test" });
    await db.insert(schema.people).values({ orgId, name: "Henry Bova" });
    await db.insert(schema.people).values({ orgId, name: "Has a login", email: "taken@example.test", userId });
    const found = (await links.usableInviteLink(await links.standingInviteLink(orgId, null)))!;

    expect((await links.claimablePeople(found, "alex@example.test")).map((p) => p.id)).toEqual([alex.id]);
    expect(await links.claimablePeople(found, "stranger@example.test")).toEqual([]);
    expect(await links.claimablePeople(found, "taken@example.test")).toEqual([]);
  });
});
