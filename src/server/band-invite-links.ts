import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { bandMembers } from "./band-member";
import { normalizeEmail } from "./people";

/*
 * Invite links to join a label-made band account, or a label itself (see schema.bandInviteLinks). Each band has one
 * standing link: whoever opens it signs in, or signs up with any email, and becomes one of the
 * band's logins (a member's own, or the band's shared one), until the link is reset. Older links
 * were single-use: once used (usedAt), they stay dead.
 */

/** "2026-09-27 14:03:00" in UTC, like the rest of the app's timestamps. */
export const stamp = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");

/** A standing link never runs out (until it's reset). */
const NEVER = "9999-12-31 00:00:00";

/**
 * A band account's standing invite link, the same every time: whoever has it can join, until the
 * link is reset. Made the first time it's needed (the newest open link, if there are older ones).
 * `memberTypeId`: a label's link for one of its member types, which whoever joins with it gets.
 */
export async function standingInviteLink(bandOrgId: string, createdByUserId: string | null, memberTypeId: number | null = null): Promise<string> {
  const [open] = await db
    .select({ id: schema.bandInviteLinks.id })
    .from(schema.bandInviteLinks)
    .where(
      and(
        eq(schema.bandInviteLinks.orgId, bandOrgId),
        memberTypeId === null ? isNull(schema.bandInviteLinks.memberTypeId) : eq(schema.bandInviteLinks.memberTypeId, memberTypeId),
        eq(schema.bandInviteLinks.forBands, false),
        isNull(schema.bandInviteLinks.usedAt),
        isNull(schema.bandInviteLinks.canceledAt),
        gt(schema.bandInviteLinks.expiresAt, stamp(new Date())),
      ),
    )
    .orderBy(desc(schema.bandInviteLinks.createdAt))
    .limit(1);
  if (open) return open.id;
  const id = randomUUID();
  await db.insert(schema.bandInviteLinks).values({ id, orgId: bandOrgId, createdByUserId, memberTypeId, expiresAt: NEVER });
  return id;
}

/** Reset: every open link to the band's account stops working, and a new standing one replaces them. */
export async function resetStandingLink(bandOrgId: string, createdByUserId: string | null) {
  await db
    .update(schema.bandInviteLinks)
    .set({ canceledAt: stamp(new Date()) })
    .where(
      and(
        eq(schema.bandInviteLinks.orgId, bandOrgId),
        eq(schema.bandInviteLinks.forBands, false),
        isNull(schema.bandInviteLinks.usedAt),
        isNull(schema.bandInviteLinks.canceledAt),
      ),
    );
  return standingInviteLink(bandOrgId, createdByUserId);
}

/**
 * A label's standing invite link for bands, the same every time: a band's admin opens it and their
 * band's group joins the label (src/server/label-join.ts). Made the first time it's needed.
 */
export async function bandsInviteLink(labelOrgId: string, createdByUserId: string | null): Promise<string> {
  const [open] = await db
    .select({ id: schema.bandInviteLinks.id })
    .from(schema.bandInviteLinks)
    .where(and(eq(schema.bandInviteLinks.orgId, labelOrgId), eq(schema.bandInviteLinks.forBands, true), isNull(schema.bandInviteLinks.canceledAt)))
    .orderBy(desc(schema.bandInviteLinks.createdAt))
    .limit(1);
  if (open) return open.id;
  const id = randomUUID();
  await db.insert(schema.bandInviteLinks).values({ id, orgId: labelOrgId, createdByUserId, forBands: true, expiresAt: NEVER });
  return id;
}

/** Reset the label's invite link for bands: the old one stops working (bands that joined stay). */
export async function resetBandsInviteLink(labelOrgId: string, createdByUserId: string | null) {
  await db
    .update(schema.bandInviteLinks)
    .set({ canceledAt: stamp(new Date()) })
    .where(and(eq(schema.bandInviteLinks.orgId, labelOrgId), eq(schema.bandInviteLinks.forBands, true), isNull(schema.bandInviteLinks.canceledAt)));
  return bandsInviteLink(labelOrgId, createdByUserId);
}

/** A label's invite link for bands that can still be used, with the label, or null. */
export async function usableBandsLink(id: string) {
  const [row] = await db
    .select({ link: schema.bandInviteLinks, label: schema.organization })
    .from(schema.bandInviteLinks)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.bandInviteLinks.orgId))
    .where(eq(schema.bandInviteLinks.id, id));
  if (!row?.link.forBands || row.label.kind !== "label" || row.link.canceledAt || row.link.expiresAt <= stamp(new Date())) return null;
  return row;
}

/**
 * The band groups a login runs (owner or admin), for joining a label with its invite link for bands,
 * each with why it can't, if it can't: it's already on this label, a label made it (it's that
 * label's already), or it joined another label (its sales can only go to one).
 */
export async function groupsToJoinWith(userId: string, labelOrgId: string) {
  const mine = await db
    .select({ id: schema.organization.id, name: schema.organization.name })
    .from(schema.member)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
    .where(and(eq(schema.member.userId, userId), eq(schema.organization.kind, "band"), inArray(schema.member.role, ["owner", "admin"])))
    .orderBy(asc(schema.organization.name));
  if (!mine.length) return [];
  const links = await db
    .select({ bandOrgId: schema.accountLinks.bandOrgId, labelOrgId: schema.accountLinks.labelOrgId, managed: schema.accountLinks.managed, joined: schema.accountLinks.joined })
    .from(schema.accountLinks)
    .where(and(inArray(schema.accountLinks.bandOrgId, mine.map((m) => m.id)), eq(schema.accountLinks.status, "active")));
  return mine.map((g) => {
    const its = links.filter((l) => l.bandOrgId === g.id);
    const why = its.some((l) => l.labelOrgId === labelOrgId)
      ? "already on this label"
      : its.some((l) => l.managed)
        ? "made by another label"
        : its.some((l) => l.joined)
          ? "on another label"
          : null;
    return { ...g, why };
  });
}

/** A link that can still be used, with its band account and label, or null. */
export async function usableInviteLink(id: string) {
  const [row] = await db
    .select({ link: schema.bandInviteLinks, org: schema.organization, personName: schema.people.name })
    .from(schema.bandInviteLinks)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.bandInviteLinks.orgId))
    .leftJoin(schema.people, eq(schema.people.id, schema.bandInviteLinks.personId))
    .where(eq(schema.bandInviteLinks.id, id));
  if (!row || row.link.forBands || row.link.usedAt || row.link.canceledAt || row.link.expiresAt <= stamp(new Date())) return null;
  const own = { link: row.link, band: row.org, personName: row.personName, labelName: null, labelOrgId: row.org.id, bandId: null, forLabel: true as const };
  // A label's own invite link (or a band that runs its own account): whoever opens it becomes one of
  // its members, in its own books.
  if (row.org.kind === "label") return own;
  const [label] = await db
    .select({ name: schema.organization.name, labelOrgId: schema.accountLinks.labelOrgId, bandId: schema.accountLinks.labelBandId })
    .from(schema.accountLinks)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.accountLinks.labelOrgId))
    .where(and(eq(schema.accountLinks.bandOrgId, row.org.id), eq(schema.accountLinks.managed, true)));
  if (!label) return own;
  return { link: row.link, band: row.org, personName: row.personName, labelName: label.name, labelOrgId: label.labelOrgId, bandId: label.bandId, forLabel: false as const };
}

/** The band's members in the label's books who don't have a login of their own on its account yet. */
export async function unclaimedMembers(bandOrgId: string, labelOrgId: string, bandId: number) {
  const [members, claimed] = await Promise.all([
    bandMembers(labelOrgId, bandId),
    db.select({ personId: schema.bandLoginPeople.personId }).from(schema.bandLoginPeople).where(eq(schema.bandLoginPeople.orgId, bandOrgId)),
  ]);
  return members.filter((m) => !claimed.some((c) => c.personId === m.id));
}

/**
 * Who someone joining with an invite link may say they are: the people without a login yet (for a
 * label-made band account, the band's members) whose email on file is the one they signed in with.
 * Anyone else with the link joins as someone new: otherwise they could become anyone listed, and
 * change how that person is paid. (Emails aren't checked, so this asks for the exact address.)
 */
export async function claimablePeople(found: NonNullable<Awaited<ReturnType<typeof usableInviteLink>>>, email: string) {
  const mine = normalizeEmail(email);
  if (!mine) return [];
  const open = found.forLabel ? await unclaimedPeople(found.labelOrgId) : await unclaimedMembers(found.band.id, found.labelOrgId, found.bandId);
  if (!open.length) return [];
  const emails = await db
    .select({ id: schema.people.id, email: schema.people.email })
    .from(schema.people)
    .where(inArray(schema.people.id, open.map((p) => p.id)));
  return open.filter((p) => emails.some((e) => e.id === p.id && normalizeEmail(e.email) === mine));
}

/** A label's people who don't have a login yet, there or in one of its bands' accounts (for its own invite link). */
export async function unclaimedPeople(labelOrgId: string) {
  const [open, viaBand] = await Promise.all([
    db
      .select({ id: schema.people.id, name: schema.people.name })
      .from(schema.people)
      .where(and(eq(schema.people.orgId, labelOrgId), isNull(schema.people.userId)))
      .orderBy(asc(schema.people.name)),
    db
      .select({ personId: schema.bandLoginPeople.personId })
      .from(schema.bandLoginPeople)
      .innerJoin(schema.accountLinks, eq(schema.accountLinks.bandOrgId, schema.bandLoginPeople.orgId))
      .where(eq(schema.accountLinks.labelOrgId, labelOrgId)),
  ]);
  return open.filter((p) => !viaBand.some((b) => b.personId === p.id));
}

/** Whether a band account already has its shared login (a login that isn't one member's own). */
export async function hasSharedLogin(bandOrgId: string) {
  const [logins, personal] = await Promise.all([
    db.select({ userId: schema.member.userId }).from(schema.member).where(eq(schema.member.organizationId, bandOrgId)),
    db.select({ userId: schema.bandLoginPeople.userId }).from(schema.bandLoginPeople).where(eq(schema.bandLoginPeople.orgId, bandOrgId)),
  ]);
  return logins.some((l) => !personal.some((p) => p.userId === l.userId));
}

/** Which member each of a band account's member logins is (person id), by user id. */
export async function bandLoginPersons(bandOrgId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ userId: schema.bandLoginPeople.userId, personId: schema.bandLoginPeople.personId })
    .from(schema.bandLoginPeople)
    .where(eq(schema.bandLoginPeople.orgId, bandOrgId));
  return new Map(rows.map((r) => [r.userId, r.personId]));
}

/** The member each of a band account's personal logins is, by user id. */
export async function bandLoginNames(bandOrgId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ userId: schema.bandLoginPeople.userId, name: schema.people.name })
    .from(schema.bandLoginPeople)
    .innerJoin(schema.people, eq(schema.people.id, schema.bandLoginPeople.personId))
    .where(eq(schema.bandLoginPeople.orgId, bandOrgId));
  return new Map(rows.map((r) => [r.userId, r.name]));
}

/**
 * The band accounts a login runs that it could connect to a label in place of the account the
 * label made for one of its bands: bands that run their own account (not one a label made), where
 * it's an owner or admin, not already connected to this label.
 */
export async function connectableAccounts(userId: string, labelOrgId: string) {
  const mine = await db
    .select({ id: schema.organization.id, name: schema.organization.name })
    .from(schema.member)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
    .where(and(eq(schema.member.userId, userId), eq(schema.organization.kind, "band"), inArray(schema.member.role, ["owner", "admin"])));
  if (!mine.length) return [];
  const links = await db
    .select({ bandOrgId: schema.accountLinks.bandOrgId, labelOrgId: schema.accountLinks.labelOrgId, managed: schema.accountLinks.managed })
    .from(schema.accountLinks)
    .where(inArray(schema.accountLinks.bandOrgId, mine.map((m) => m.id)));
  return mine.filter((m) => !links.some((l) => l.bandOrgId === m.id && (l.managed || l.labelOrgId === labelOrgId)));
}

/** Whether nobody uses a label-made band account yet (no logins, nothing in its own books): it can make way for the band's own account. */
export async function unusedBandAccount(bandOrgId: string) {
  const { sales, periods, expenses, member } = schema;
  const [[login], [sale], [payout], [receipt]] = await Promise.all([
    db.select({ id: member.id }).from(member).where(eq(member.organizationId, bandOrgId)).limit(1),
    db.select({ id: sales.id }).from(sales).where(eq(sales.orgId, bandOrgId)).limit(1),
    db.select({ id: periods.id }).from(periods).where(eq(periods.orgId, bandOrgId)).limit(1),
    db.select({ id: expenses.id }).from(expenses).where(eq(expenses.orgId, bandOrgId)).limit(1),
  ]);
  return !login && !sale && !payout && !receipt;
}
