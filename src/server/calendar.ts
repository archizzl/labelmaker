import "server-only";
import { and, asc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Mark } from "@/lib/availability";
import type { Context } from "./context";

/*
 * The calendar (src/lib/availability.ts has its rules): the people in a group, when each is free,
 * and the group's plans. It's the group's own, the one the person is in (for a band account the
 * label made, that small account, not the label's books it looks at), and everyone with their own
 * account in it takes part. A band's shared login is the band, not a person: it sees the calendar
 * but has no days of its own.
 */

export type CalendarPerson = { id: string; name: string; image: string | null };

export type Plan = typeof schema.plans.$inferSelect;

/** The group the calendar is for. */
export const calendarGroup = (ctx: Context) => ctx.org.id;

/** Everyone in the group with their own account, by name. */
export async function calendarPeople(ctx: Context): Promise<CalendarPerson[]> {
  const orgId = calendarGroup(ctx);
  const [rows, personal] = await Promise.all([
    db
      .select({ id: schema.user.id, name: schema.user.name, image: schema.user.image })
      .from(schema.member)
      .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
      .where(eq(schema.member.organizationId, orgId)),
    ctx.managedBy ? db.select({ userId: schema.bandLoginPeople.userId }).from(schema.bandLoginPeople).where(eq(schema.bandLoginPeople.orgId, orgId)) : null,
  ]);
  const own = personal ? new Set(personal.map((p) => p.userId)) : null;
  return rows.filter((r) => !own || own.has(r.id)).sort((a, b) => a.name.localeCompare(b.name));
}

/** The signed-in person, if they take part (not a band's shared login). */
export const calendarMe = (ctx: Context, people: CalendarPerson[]) => (people.some((p) => p.id === ctx.user.id) ? ctx.user.id : null);

/** These people's marks from one date to another. */
export async function marksBetween(userIds: string[], from: string, to: string): Promise<Mark[]> {
  if (!userIds.length) return [];
  const a = schema.availability;
  return db
    .select({ userId: a.userId, date: a.date, hour: a.hour, available: a.available })
    .from(a)
    .where(and(inArray(a.userId, userIds), gte(a.date, from), lte(a.date, to)));
}

/** The group's plans that could be or are on these days, and any still to pick a day for. */
export async function plansBetween(orgId: string, from: string, to: string): Promise<Plan[]> {
  const p = schema.plans;
  return db
    .select()
    .from(p)
    .where(and(eq(p.orgId, orgId), or(and(lte(p.fromDate, to), gte(p.toDate, from)), and(gte(p.date, from), lte(p.date, to)), isNull(p.date))))
    .orderBy(asc(p.date), asc(p.fromDate));
}

/** Plans from today on (and any still to pick a day for), soonest first. */
export async function upcomingPlans(orgId: string, today: string): Promise<Plan[]> {
  const p = schema.plans;
  return db
    .select()
    .from(p)
    .where(and(eq(p.orgId, orgId), or(gte(p.date, today), and(isNull(p.date), gte(p.toDate, today)))))
    .orderBy(asc(p.date), asc(p.fromDate));
}

export async function planIn(orgId: string, id: number): Promise<Plan | null> {
  const [row] = await db
    .select()
    .from(schema.plans)
    .where(and(eq(schema.plans.orgId, orgId), eq(schema.plans.id, id)));
  return row ?? null;
}

/** Who a plan is for: those it names who are still in the group, or everyone. */
export function planPeople(plan: Pick<Plan, "userIds">, people: CalendarPerson[]) {
  if (!plan.userIds?.length) return people;
  const named = people.filter((p) => plan.userIds!.includes(p.id));
  return named.length ? named : people;
}

/** Whoever made a plan can change it, and the group's admins. */
export const mayChangePlan = (ctx: Context, plan: Pick<Plan, "createdByUserId">) => plan.createdByUserId === ctx.user.id || ctx.org.role !== "member";

/**
 * Quick picks of people for a plan: each band in a label's books whose people have accounts in the
 * group (two or more of them).
 */
export async function bandsOfPeople(ctx: Context, people: CalendarPerson[]): Promise<{ name: string; userIds: string[] }[]> {
  if (ctx.org.kind !== "label" || people.length < 3) return [];
  const ids = people.map((p) => p.id);
  const rows = await db
    .select({ band: schema.bands.name, userId: schema.people.userId })
    .from(schema.bandMemberships)
    .innerJoin(schema.bands, eq(schema.bands.id, schema.bandMemberships.bandId))
    .innerJoin(schema.people, eq(schema.people.id, schema.bandMemberships.personId))
    .where(and(eq(schema.bandMemberships.orgId, ctx.org.id), eq(schema.bandMemberships.active, true), inArray(schema.people.userId, ids)));
  const byBand = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.userId) continue;
    if (!byBand.has(r.band)) byBand.set(r.band, new Set());
    byBand.get(r.band)!.add(r.userId);
  }
  return [...byBand]
    .filter(([, u]) => u.size >= 2 && u.size < people.length)
    .map(([name, u]) => ({ name, userIds: [...u] }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
