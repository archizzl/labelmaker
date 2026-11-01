import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { newAccount, testDb } from "../../../test/helpers/db";

let orgId = "";
const ctx = () => ({ orgId, access: { admin: true, permissions: {}, bandAreas: [], bandIds: [] } });
vi.mock("../context", () => ({ requireAccess: async () => ctx(), getContext: async () => ctx(), ownBooksOf: async () => ctx() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let db: Awaited<ReturnType<typeof testDb>>["db"];
let schema: Awaited<ReturnType<typeof testDb>>["schema"];
let actions: typeof import("../expense-actions");

beforeAll(async () => {
  ({ db, schema } = await testDb());
  actions = await import("../expense-actions");
});

const form = (values: Record<string, string | number>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, String(v));
  return fd;
};

describe("reviewing a receipt", () => {
  it("can reopen a rejected one, and says why approving fails beside the form", async () => {
    orgId = await newAccount();
    const [e] = await db.insert(schema.expenses).values({ orgId, date: "2026-01-10", description: "Strings", amountCents: 1200, paidBy: "label" }).returning();
    const status = async () => (await db.select().from(schema.expenses).where(eq(schema.expenses.id, e.id)))[0];

    await actions.reviewExpense(form({ id: e.id, decision: "reject", note: "Not ours" }));
    expect(await status()).toMatchObject({ status: "rejected", reviewNote: "Not ours" });
    await actions.reviewExpense(form({ id: e.id, decision: "reopen" }));
    expect(await status()).toMatchObject({ status: "pending", reviewNote: null, reviewedAt: null });

    // Paying it back from sales needs a band: the form shows why instead of the error page.
    expect(await actions.reviewExpenseForm(null, form({ id: e.id, decision: "approve", recoup: "on" }))).toEqual({
      error: "Choose a band, release or project for this expense first (edit it), so its sales can pay it back.",
    });
    expect((await status()).status).toBe("pending");
  });
});
