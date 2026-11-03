import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { newAccount, testDb } from "../../../test/helpers/db";

let orgId = "";
vi.mock("../context", () => ({ requireAccess: async () => ({ orgId }), requireAdmin: async () => ({ orgId }), getContext: async () => ({ orgId }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let db: Awaited<ReturnType<typeof testDb>>["db"];
let schema: Awaited<ReturnType<typeof testDb>>["schema"];
let actions: typeof import("../actions");

beforeAll(async () => {
  ({ db, schema } = await testDb());
  actions = await import("../actions");
});

const form = (values: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
};

describe("a deduction's percentage or amount", () => {
  it("is refused when it isn't a number, rather than saved as nothing", async () => {
    orgId = await newAccount();
    expect(await actions.saveDeductionForm(null, form({ kind: "percent", destination: "label", percent: "abc" }))).toEqual({ error: "Enter a percentage from 0 to 100." });
    expect(await actions.saveDeductionForm(null, form({ kind: "percent", destination: "label", percent: "150" }))).toEqual({ error: "Enter a percentage from 0 to 100." });
    expect(await actions.saveDeductionForm(null, form({ kind: "fixed", destination: "label", amount: "" }))).toEqual({ error: "Enter an amount." });
    expect(await db.select().from(schema.deductions).where(eq(schema.deductions.orgId, orgId))).toEqual([]);

    expect(await actions.saveDeductionForm(null, form({ kind: "percent", destination: "label", percent: "20" }))).toEqual({ ok: "Added." });
    const [d] = await db.select().from(schema.deductions).where(eq(schema.deductions.orgId, orgId));
    expect(d.percentBps).toBe(2000);
  });
});
