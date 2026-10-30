import "server-only";
import { randomBytes } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { stamp } from "./band-invite-links";
import { moveSalesToLabel } from "./own-books";

/*
 * A band's own group joining a label, with the label's invite link for bands: for labels that put
 * their bands together here rather than on a Bandcamp label account. The label's books get the band
 * (named as the group is) and its people, linked to the group (accountLinks.joined). From then on
 * the group's sales go into the label's books, to be split and paid out there, as a band group the
 * label made does; it keeps its books from before. Bandcamp pays the band, not the label
 * (bands.paidTo), until the label says otherwise.
 */

const { accountLinks, bandMemberships, bands, people } = schema;

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
  const members = own
    ? await db
        .select({ person: people, roles: bandMemberships.roles, active: bandMemberships.active })
        .from(bandMemberships)
        .innerJoin(people, eq(people.id, bandMemberships.personId))
        .where(and(eq(bandMemberships.orgId, bandOrgId), eq(bandMemberships.bandId, own.id)))
    : [];
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
    // Its people, in the label's books too: their details stay the same in both (people.labelPersonId).
    for (const { person: p, roles, active } of members) {
      // Someone who left before the band joined doesn't need a record there.
      if (!active) continue;
      const [copy] = await tx
        .insert(people)
        .values({ orgId: labelOrgId, name: p.name, email: p.email, paypalMe: p.paypalMe, venmo: p.venmo, cashtag: p.cashtag })
        .returning({ id: people.id });
      await tx.insert(bandMemberships).values({ orgId: labelOrgId, bandId: band.id, personId: copy.id, roles, active: true });
      await tx
        .update(people)
        .set({ labelPersonId: copy.id })
        .where(and(eq(people.id, p.id), isNull(people.labelPersonId)));
    }
    return { linkId: link.id, bandId: band.id };
  });
  // Sales from today on (there are none yet, unless they were added today).
  await moveSalesToLabel(bandOrgId);
  return result;
}
