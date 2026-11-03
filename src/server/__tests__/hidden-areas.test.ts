import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { newAccount, testDb } from "../../../test/helpers/db";

let orgId = "";
vi.mock("../context", () => ({ requireAdmin: async () => ({ orgId }), accountContext: async () => ({ orgId }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));

let db: Awaited<ReturnType<typeof testDb>>["db"];
let schema: Awaited<ReturnType<typeof testDb>>["schema"];
let actions: typeof import("../account-actions");
let permissions: typeof import("@/lib/permissions");

beforeAll(async () => {
  ({ db, schema } = await testDb());
  actions = await import("../account-actions");
  permissions = await import("@/lib/permissions");
});

describe("sections not offered for now (Fans)", () => {
  it("aren't in the editor or descriptions, and saving a member type keeps what they had", async () => {
    orgId = await newAccount();
    expect(permissions.SHOWN_AREAS.map((a) => a.key)).not.toContain("fans");
    expect(permissions.describePermissions({ fans: "edit", sales: "view" }, [])).toBe("Sales: view");

    const [t] = await db.insert(schema.memberTypes).values({ orgId, name: "Helper", permissions: { fans: "edit", sales: "view" }, bandAreas: [] }).returning();
    const fd = new FormData();
    fd.set("id", String(t.id));
    fd.set("name", "Helper");
    fd.set("perm:sales", "edit");
    expect(await actions.saveMemberType(null, fd)).toEqual({ ok: "Saved Helper." });
    const [after] = await db.select().from(schema.memberTypes).where(eq(schema.memberTypes.id, t.id));
    expect(after.permissions).toEqual({ sales: "edit", fans: "edit" });
  });
});
