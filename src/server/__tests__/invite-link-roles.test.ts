import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { newAccount, testDb } from "../../../test/helpers/db";

// Who's signed in, and the group they're an admin of.
let session = { user: { id: "", name: "", email: "" } };
let orgId = "";
let managedBy: { labelOrgId: string; bandId: number } | null = null;
vi.mock("../context", () => ({
  getSession: async () => session,
  requireAdmin: async () => ({ orgId, org: { kind: "label" }, managedBy, user: { id: session.user.id } }),
}));
vi.mock("../auth", () => ({ auth: { api: { setActiveOrganization: async () => {}, updateUser: async () => {} } } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("redirect"), { to });
  },
}));

let db: Awaited<ReturnType<typeof testDb>>["db"];
let schema: Awaited<ReturnType<typeof testDb>>["schema"];
let links: typeof import("../band-invite-links");
let actions: typeof import("../band-invite-actions");

beforeAll(async () => {
  ({ db, schema } = await testDb());
  links = await import("../band-invite-links");
  actions = await import("../band-invite-actions");
});

async function signIn(name: string) {
  const id = randomUUID();
  const email = `${id}@example.test`;
  await db.insert(schema.user).values({ id, name, email, emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
  session = { user: { id, name, email } };
  return id;
}

async function join(linkId: string, name: string) {
  const fd = new FormData();
  fd.set("id", linkId);
  fd.set("as", "new");
  fd.set("name", name);
  await expect(actions.joinWithInviteLink(null, fd)).rejects.toMatchObject({ to: "/" });
}

async function roleAndType(org: string, userId: string) {
  const [m] = await db
    .select({ role: schema.member.role })
    .from(schema.member)
    .where(and(eq(schema.member.organizationId, org), eq(schema.member.userId, userId)));
  const types = await db
    .select()
    .from(schema.memberTypeAssignments)
    .where(and(eq(schema.memberTypeAssignments.orgId, org), eq(schema.memberTypeAssignments.userId, userId)));
  return { role: m?.role, types: types.length };
}

describe("a group's invite links for admins and members", () => {
  for (const kind of ["label", "band"] as const) {
    it(`make whoever joins an admin, or a member with no member type (${kind})`, async () => {
      const org = await newAccount("Group", kind);
      const adminLink = await links.standingInviteLink(org, null, { admin: true });
      const memberLink = await links.standingInviteLink(org, null);
      expect(adminLink).not.toBe(memberLink);
      expect(await links.standingInviteLink(org, null, { admin: true })).toBe(adminLink);

      const ana = await signIn("Ana");
      await join(adminLink, "Ana");
      expect(await roleAndType(org, ana)).toEqual({ role: "admin", types: 0 });

      const ben = await signIn("Ben");
      await join(memberLink, "Ben");
      expect(await roleAndType(org, ben)).toEqual({ role: "member", types: 0 });
    });
  }
});

describe("resetting an invite link", () => {
  it("ends just that link, of this group's", async () => {
    orgId = await newAccount();
    await signIn("Admin");
    const [t] = await db.insert(schema.memberTypes).values({ orgId, name: "Manager", permissions: {} }).returning();
    const adminLink = await links.standingInviteLink(orgId, null, { admin: true });
    const memberLink = await links.standingInviteLink(orgId, null);
    const typeLink = await links.standingInviteLink(orgId, null, { memberTypeId: t.id });

    const fd = new FormData();
    fd.set("gives", "admin");
    await actions.resetInviteLink(fd);
    expect(await links.usableInviteLink(adminLink)).toBeNull();
    expect(await links.standingInviteLink(orgId, null, { admin: true })).not.toBe(adminLink);
    expect(await links.usableInviteLink(memberLink)).not.toBeNull();
    expect(await links.usableInviteLink(typeLink)).not.toBeNull();

    fd.set("gives", `type:${t.id}`);
    await actions.resetInviteLink(fd);
    expect(await links.usableInviteLink(typeLink)).toBeNull();
    expect(await links.usableInviteLink(memberLink)).not.toBeNull();

    fd.set("gives", "member");
    await actions.resetInviteLink(fd);
    expect(await links.usableInviteLink(memberLink)).toBeNull();

    // Another group's member type: not this group's link to reset.
    const other = await newAccount();
    const [theirs] = await db.insert(schema.memberTypes).values({ orgId: other, name: "Theirs", permissions: {} }).returning();
    fd.set("gives", `type:${theirs.id}`);
    await expect(actions.resetInviteLink(fd)).rejects.toThrow();
  });

  it("in a band's group from the label: resets its one link, with no link for admins", async () => {
    orgId = await newAccount("Band", "band");
    managedBy = { labelOrgId: await newAccount(), bandId: 1 };
    try {
      await signIn("Band");
      const link = await links.standingInviteLink(orgId, null);
      const fd = new FormData();
      fd.set("gives", "admin");
      await expect(actions.resetInviteLink(fd)).rejects.toThrow();
      expect(await links.usableInviteLink(link)).not.toBeNull();
      fd.set("gives", "member");
      await actions.resetInviteLink(fd);
      expect(await links.usableInviteLink(link)).toBeNull();
    } finally {
      managedBy = null;
    }
  });
});
