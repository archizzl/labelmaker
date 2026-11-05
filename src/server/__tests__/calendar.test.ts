import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { newAccount, testDb } from "../../../test/helpers/db";
import type { Context } from "../context";

/*
 * The calendar's actions (src/server/calendar-actions.ts): marking days and hours, and plans, kept
 * to the group and to whoever may change them.
 */

let who = {} as Context;
const as = (orgId: string, userId: string, role: "admin" | "member" = "member", kind: "label" | "band" = "label") => {
  who = {
    user: { id: userId, name: userId, email: `${userId}@example.test` },
    org: { id: orgId, name: "Test Label", slug: "t", kind, role },
    orgId,
    role,
    isAdmin: role === "admin",
    access: { admin: role === "admin", permissions: {}, bandAreas: [], bandIds: [] },
    memberType: null,
    person: null,
    accounts: [],
    managedBy: null,
    viewingAs: null,
    lens: false,
  };
};
vi.mock("../context", () => ({ getContext: async () => who, accountContext: async () => who }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let db: Awaited<ReturnType<typeof testDb>>["db"];
let schema: Awaited<ReturnType<typeof testDb>>["schema"];
let actions: typeof import("../calendar-actions");

beforeAll(async () => {
  ({ db, schema } = await testDb());
  actions = await import("../calendar-actions");
});

/** A group with these people signing in to it. */
async function group(...names: string[]) {
  return groupOf("label", ...names);
}

async function groupOf(kind: "label" | "band", ...names: string[]) {
  const orgId = await newAccount(`Group ${names.join(" ")}`, kind);
  const ids: string[] = [];
  for (const n of names) {
    const id = `${n}-${Math.random().toString(36).slice(2)}`;
    await db.insert(schema.user).values({ id, name: n, email: `${id}@example.test`, emailVerified: false, createdAt: new Date(), updatedAt: new Date() });
    await db.insert(schema.member).values({ id: `m-${id}`, organizationId: orgId, userId: id, role: "member", createdAt: new Date() });
    ids.push(id);
  }
  return { orgId, ids };
}

const fd = (fields: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of [v].flat()) f.append(k, x);
  return f;
};

const marksOf = async (userId: string) =>
  (await db.select().from(schema.availability).where(eq(schema.availability.userId, userId)))
    .map((m) => `${m.date}${m.hour === null ? "" : ` ${m.hour}`} ${m.available ? "yes" : "no"}`)
    .sort();

/** A redirect's address, from the error Next throws for it. */
async function redirected(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (e) {
    const digest = (e as { digest?: string }).digest ?? "";
    if (digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2];
    throw e;
  }
  return null;
}

describe("marking days", () => {
  it("saves whole days and hours, an hour's mark over its day's", async () => {
    const { orgId, ids } = await group("Ana");
    as(orgId, ids[0]);
    expect(await actions.setDays(fd({ dates: ["2026-11-14", "2026-11-15"], value: "yes" }))).toEqual({ ok: "Saved." });
    expect(await actions.setHours(fd({ date: "2026-11-14", hours: ["20", "21"], value: "no" }))).toEqual({ ok: "Saved." });
    expect(await marksOf(ids[0])).toEqual(["2026-11-14 20 no", "2026-11-14 21 no", "2026-11-14 yes", "2026-11-15 yes"]);
    // Marking the whole day again replaces its hours.
    await actions.setDays(fd({ dates: ["2026-11-14"], value: "no" }));
    await actions.setDays(fd({ dates: ["2026-11-15"], value: "clear" }));
    expect(await marksOf(ids[0])).toEqual(["2026-11-14 no"]);
  });

  it("turns down days that aren't days", async () => {
    const { orgId, ids } = await group("Ana");
    as(orgId, ids[0]);
    expect(await actions.setDays(fd({ dates: ["2026-02-30"], value: "yes" }))).toEqual({ error: "Those aren’t days." });
    expect(await actions.setHours(fd({ date: "2026-11-14", hours: ["24"], value: "yes" }))).toEqual({ error: "Choose hours from 0 to 23." });
  });

  it("is only for people in the group", async () => {
    const { orgId } = await group("Ana");
    as(orgId, "someone-else");
    await expect(actions.setDays(fd({ dates: ["2026-11-14"], value: "yes" }))).rejects.toThrow(/sign in to this group/);
  });
});

describe("plans", () => {
  it("are made for some people, have their day picked, and are changed only by whoever made them or an admin", async () => {
    const { orgId, ids } = await group("Ana", "Ben", "Cy");
    as(orgId, ids[0]);
    const to = await redirected(() => actions.savePlan(null, fd({ title: "Rehearsal", fromDate: "2026-11-10", toDate: "2026-11-20", people: "1", userIds: [ids[0], ids[1]] })));
    expect(to).toMatch(/^\/calendar\/plans\/\d+$/);
    const id = to!.split("/").at(-1)!;
    const [plan] = await db.select().from(schema.plans).where(eq(schema.plans.id, Number(id)));
    expect(plan).toMatchObject({ title: "Rehearsal", orgId, userIds: [ids[0], ids[1]], createdByUserId: ids[0] });

    expect(await actions.pickPlanDate(null, fd({ id, date: "2026-11-14", startHour: "19", endHour: "23" }))).toEqual({ ok: "Day picked." });
    expect(await actions.pickPlanDate(null, fd({ id, date: "2026-11-14", startHour: "19", endHour: "19" }))).toEqual({ error: "Choose an end time after the start." });
    const [picked] = await db.select().from(schema.plans).where(eq(schema.plans.id, Number(id)));
    expect(picked).toMatchObject({ date: "2026-11-14", startHour: 19, endHour: 23 });

    as(orgId, ids[2]);
    expect(await actions.pickPlanDate(null, fd({ id, date: "" }))).toEqual({ error: "Only whoever made the plan, or an admin, can pick its day." });
    as(orgId, ids[2], "admin");
    expect(await actions.savePlan(null, fd({ id, title: "Rehearsal", fromDate: "2026-11-10", toDate: "2026-11-20", people: "1", userIds: ids }))).toEqual({ ok: "Saved." });
    // Everyone ticked is everyone.
    const [all] = await db.select().from(schema.plans).where(eq(schema.plans.id, Number(id)));
    expect(all.userIds).toBeNull();
  });

  it("for a label's band show in the band's own group, with everyone in the band", async () => {
    const label = await group("Lee");
    const bandGroup = await groupOf("band", "Ana", "Ben");
    const other = await groupOf("band", "Cy");
    const [band] = await db.insert(schema.bands).values({ orgId: label.orgId, name: "Flag Day" }).returning();
    const [otherBand] = await db.insert(schema.bands).values({ orgId: label.orgId, name: "Other" }).returning();
    await db.insert(schema.accountLinks).values([
      { labelOrgId: label.orgId, labelBandId: band.id, bandOrgId: bandGroup.orgId, code: `c-${band.id}`, status: "active", managed: true },
      { labelOrgId: label.orgId, labelBandId: otherBand.id, bandOrgId: other.orgId, code: `c-${otherBand.id}`, status: "active", managed: true },
    ]);
    as(label.orgId, label.ids[0], "admin");
    const to = await redirected(() => actions.savePlan(null, fd({ title: "Rehearsal", fromDate: "2026-11-10", toDate: "2026-11-20", bandId: String(band.id) })));
    const id = Number(to!.split("/").at(-1));

    const calendar = await import("../calendar");
    // The band's group sees it, and its people are the band's.
    as(bandGroup.orgId, bandGroup.ids[0], "member", "band");
    const plan = await calendar.visiblePlan(who, id);
    expect(plan).toMatchObject({ title: "Rehearsal", bandName: "Flag Day" });
    expect((await calendar.upcomingPlans(who, "2026-11-01")).map((p) => p.id)).toContain(id);
    expect((await calendar.planBase(plan!)).map((p) => p.id).sort()).toEqual([...bandGroup.ids].sort());
    // Band members mark their days for it.
    expect(await actions.setDays(fd({ dates: ["2026-11-14"], value: "yes" }))).toEqual({ ok: "Saved." });
    // Another band's group doesn't see it.
    as(other.orgId, other.ids[0], "admin", "band");
    expect(await calendar.visiblePlan(who, id)).toBeNull();
    // The band's admins can pick its day, but not delete the label's plan.
    as(bandGroup.orgId, bandGroup.ids[1], "admin", "band");
    expect(await actions.pickPlanDate(null, fd({ id: String(id), date: "2026-11-14" }))).toEqual({ ok: "Day picked." });
    await expect(actions.deletePlan(fd({ id: String(id) }))).rejects.toThrow(/admin of/);
  });

  it("keep to their group", async () => {
    const a = await group("Ana");
    const b = await group("Ben");
    as(a.orgId, a.ids[0]);
    const to = await redirected(() => actions.savePlan(null, fd({ title: "Show", fromDate: "2026-12-01", toDate: "2026-12-03" })));
    as(b.orgId, b.ids[0], "admin");
    expect(await actions.pickPlanDate(null, fd({ id: to!.split("/").at(-1)!, date: "2026-12-02" }))).toEqual({ error: "That plan isn’t in this group." });
  });

  it("turn down a range that's backwards or too long", async () => {
    const { orgId, ids } = await group("Ana");
    as(orgId, ids[0]);
    expect(await actions.savePlan(null, fd({ title: "x", fromDate: "2026-12-05", toDate: "2026-12-01" }))).toEqual({ error: "The last day is before the first." });
    expect(await actions.savePlan(null, fd({ title: "x", fromDate: "2026-01-01", toDate: "2026-12-31" }))).toEqual({ error: "Choose up to 92 days." });
  });
});
