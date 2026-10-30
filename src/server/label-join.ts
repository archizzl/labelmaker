import "server-only";
import { randomBytes } from "node:crypto";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { stamp } from "./band-invite-links";
import { counterpartIn, moveSalesToLabel, syncJoinedPeople } from "./own-books";

/*
 * A band's own group joining a label, with the label's invite link for bands: for labels that put
 * their bands together here rather than on a Bandcamp label account. The label's books get the band
 * (named as the group is), its members, its catalog and its splits, linked to the group
 * (accountLinks.joined). From then on the group's sales go into the label's books, to be split and
 * paid out there, as a band group the label made does; it keeps its books from before, and still
 * sees every sale. The band keeps running its members (syncJoinedPeople). Bandcamp pays the band,
 * not the label (bands.paidTo), until the label says otherwise.
 */

const { accountLinks, bands, people, releases, splitRules, splitShares, tracks } = schema;

/** Join a label: returns the link (for the band's view of the label) and the band in the label's books. */
export async function joinLabel(labelOrgId: string, bandOrgId: string, createdByUserId: string | null) {
  const [[group], [own]] = await Promise.all([
    db.select({ name: schema.organization.name }).from(schema.organization).where(eq(schema.organization.id, bandOrgId)),
    db
      .select()
      .from(bands)
      .where(and(eq(bands.orgId, bandOrgId), eq(bands.isLabel, false)))
      .orderBy(asc(bands.id))
      .limit(1),
  ]);
  if (!group) throw new Error("That band’s group is gone.");
  const result = await db.transaction(async (tx) => {
    const [band] = await tx
      .insert(bands)
      .values({
        orgId: labelOrgId,
        name: group.name,
        // How the label's catalog recognises its releases and sales.
        aliases: own?.aliases ?? [],
        urlPatterns: own?.urlPatterns ?? [],
        imageUrl: own?.imageUrl ?? null,
        location: own?.location ?? null,
        paidTo: "band",
      })
      .returning({ id: bands.id });
    const [link] = await tx
      .insert(accountLinks)
      .values({
        labelOrgId,
        labelBandId: band.id,
        bandOrgId,
        code: randomBytes(8).toString("hex"),
        status: "active",
        acceptedAt: stamp(new Date()),
        joined: true,
        createdByUserId,
      })
      .returning({ id: accountLinks.id });
    return { linkId: link.id, bandId: band.id };
  });
  // Its members (the same people in both books), then its catalog and splits, which name them.
  await syncJoinedPeople(bandOrgId);
  if (own) await copyCatalogAndSplits(labelOrgId, result.bandId, bandOrgId, own.id);
  // Sales from today on (there are none yet, unless they were added today).
  await moveSalesToLabel(bandOrgId);
  return result;
}

/**
 * The band's releases and tracks, and its splits (for the band, a kind of item, a release or a
 * track), copied into the label's books for its band there. The label's catalog sync finds the
 * releases by their Bandcamp ids and addresses, so they aren't made twice. Each share goes to the
 * same person in the label's books.
 */
async function copyCatalogAndSplits(labelOrgId: string, bandId: number, bandOrgId: string, ownBandId: number) {
  const ownReleases = await db
    .select()
    .from(releases)
    .where(and(eq(releases.orgId, bandOrgId), eq(releases.bandId, ownBandId)));
  const releaseIds = new Map<number, number>();
  for (const { id, ...r } of ownReleases) {
    const [copy] = await db
      .insert(releases)
      .values({ ...r, orgId: labelOrgId, bandId })
      .returning({ id: releases.id });
    releaseIds.set(id, copy.id);
  }
  const ownTracks = ownReleases.length
    ? await db
        .select()
        .from(tracks)
        .where(and(eq(tracks.orgId, bandOrgId), inArray(tracks.releaseId, [...releaseIds.keys()])))
    : [];
  const trackIds = new Map<number, number>();
  for (const { id, ...t } of ownTracks) {
    const [copy] = await db
      .insert(tracks)
      .values({
        ...t,
        orgId: labelOrgId,
        releaseId: releaseIds.get(t.releaseId)!,
        bandId: t.bandId === ownBandId ? bandId : null,
        // Outside artists' contacts are each group's own.
        outsideArtistId: null,
      })
      .returning({ id: tracks.id });
    trackIds.set(id, copy.id);
  }

  const rules = await db
    .select()
    .from(splitRules)
    .where(
      and(
        eq(splitRules.orgId, bandOrgId),
        or(
          eq(splitRules.bandId, ownBandId),
          releaseIds.size ? inArray(splitRules.releaseId, [...releaseIds.keys()]) : undefined,
          trackIds.size ? inArray(splitRules.trackId, [...trackIds.keys()]) : undefined,
        ),
      ),
    );
  if (!rules.length) return;
  const shares = await db.select().from(splitShares).where(inArray(splitShares.ruleId, rules.map((r) => r.id)));
  const payees = await db.select().from(people).where(inArray(people.id, [...new Set(shares.map((s) => s.personId))]));
  const counterpart = new Map<number, number>();
  for (const p of payees) counterpart.set(p.id, await counterpartIn(labelOrgId, p));
  for (const { id, ...rule } of rules) {
    // (The label-wide default stays the label's.)
    if (rule.scope === "label_default") continue;
    const [copy] = await db
      .insert(splitRules)
      .values({
        ...rule,
        orgId: labelOrgId,
        bandId: rule.bandId === ownBandId ? bandId : null,
        releaseId: rule.releaseId ? (releaseIds.get(rule.releaseId) ?? null) : null,
        trackId: rule.trackId ? (trackIds.get(rule.trackId) ?? null) : null,
      })
      .returning({ id: splitRules.id });
    const mine = shares.filter((s) => s.ruleId === id && counterpart.has(s.personId));
    if (mine.length) {
      await db.insert(splitShares).values(mine.map((s) => ({ orgId: labelOrgId, ruleId: copy.id, personId: counterpart.get(s.personId)!, bps: s.bps })));
    }
  }
}
