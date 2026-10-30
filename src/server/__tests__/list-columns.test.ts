import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { newAccount, testDb } from "../../../test/helpers/db";

let who = { orgId: "", user: { id: "" } };
vi.mock("../context", () => ({ accountContext: async () => who }));

let db: Awaited<ReturnType<typeof testDb>>["db"];
let schema: Awaited<ReturnType<typeof testDb>>["schema"];
let load: typeof import("../list-columns");
let save: typeof import("../list-column-actions");

beforeAll(async () => {
  ({ db, schema } = await testDb());
  load = await import("../list-columns");
  save = await import("../list-column-actions");
});

async function login() {
  const id = randomUUID();
  await db.insert(schema.user).values({ id, name: "Ana", email: `${id}@example.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
  return id;
}

describe("columns shown in a list of sales", () => {
  it("are each person's own, per list and group, and only real columns are kept", async () => {
    const orgId = await newAccount();
    const [ana, ben] = [await login(), await login()];
    who = { orgId, user: { id: ana } };
    expect(await load.loadHiddenColumns("sales")).toEqual([]);

    await save.saveHiddenColumns("sales", ["country", "source", "country", "nonsense"]);
    expect(await load.loadHiddenColumns("sales")).toEqual(["country", "source"]);
    expect(await load.loadHiddenColumns("items")).toEqual([]);
    await save.saveHiddenColumns("sales", ["qty"]);
    expect(await load.loadHiddenColumns("sales")).toEqual(["qty"]);

    // Someone else, or the same person in another group: their own.
    who = { orgId, user: { id: ben } };
    expect(await load.loadHiddenColumns("sales")).toEqual([]);
    who = { orgId: await newAccount("Other"), user: { id: ana } };
    expect(await load.loadHiddenColumns("sales")).toEqual([]);

    // Not a list: nothing kept.
    await save.saveHiddenColumns("whatever", ["date"]);
    expect(await db.select().from(schema.listColumns)).toHaveLength(1);
  });
});
