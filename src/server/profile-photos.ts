import "server-only";
import { eq, inArray, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { discardStoredFiles, storeFile } from "./receipt-store";

/*
 * Profile photos: one per account (a login), uploaded on Account. The account's own image points at
 * /account/photo/[id], so wherever a person with a login is shown (the header, the Directory, who
 * can sign in), their photo can be.
 */

const PREFIX = "/account/photo/";

export const profilePhotoUrl = (id: number) => `${PREFIX}${id}`;

/** A photo uploaded here, not an address on another site. */
export const isProfilePhotoUrl = (url: string) => url.startsWith(PREFIX) && /^\d+$/.test(url.slice(PREFIX.length));

/** Make this the account's photo (the one before goes). */
export async function setProfilePhoto(userId: string, file: File) {
  const stored = await storeFile(`profiles/${userId}`, file, file.type);
  let id: number;
  try {
    [{ id }] = await db
      .insert(schema.profilePhotos)
      .values({ userId, contentType: file.type, size: file.size, ...stored })
      .returning({ id: schema.profilePhotos.id });
  } catch (e) {
    await discardStoredFiles([stored]);
    throw e;
  }
  await db.update(schema.user).set({ image: profilePhotoUrl(id) }).where(eq(schema.user.id, userId));
  await clearOldPhotos(userId, id);
}

/** Take the account's photo off. */
export async function removeProfilePhoto(userId: string) {
  await db.update(schema.user).set({ image: null }).where(eq(schema.user.id, userId));
  await clearOldPhotos(userId, null);
}

/** Delete an account's photos other than `keep` (their files too). */
export async function clearOldPhotos(userId: string, keep: number | null) {
  const rows = await db.select({ id: schema.profilePhotos.id, storageKey: schema.profilePhotos.storageKey }).from(schema.profilePhotos).where(eq(schema.profilePhotos.userId, userId));
  const old = rows.filter((r) => r.id !== keep);
  for (const r of old) await db.delete(schema.profilePhotos).where(eq(schema.profilePhotos.id, r.id));
  await discardStoredFiles(old);
}

/**
 * May one login see another's photo: their own, or anyone's in a group they share, counting a label
 * and the band groups linked to it as one (the label's Directory shows its bands' logins, and a band
 * group shows the label's people).
 */
export async function canSeePhotoOf(viewerId: string, ownerId: string): Promise<boolean> {
  if (viewerId === ownerId) return true;
  const [viewerGroups, ownerGroups] = await Promise.all([groupsOf(viewerId), groupsOf(ownerId)]);
  const reach = await withLinkedGroups(viewerGroups);
  return ownerGroups.some((g) => reach.has(g));
}

/** The groups a login is in, or is someone in the books of. */
async function groupsOf(userId: string) {
  const [members, payees] = await Promise.all([
    db.select({ orgId: schema.member.organizationId }).from(schema.member).where(eq(schema.member.userId, userId)),
    db.select({ orgId: schema.people.orgId }).from(schema.people).where(eq(schema.people.userId, userId)),
  ]);
  return [...new Set([...members, ...payees].map((r) => r.orgId))];
}

/** These groups, their labels, and every band group linked to those labels. */
async function withLinkedGroups(orgIds: string[]) {
  const out = new Set(orgIds);
  if (!orgIds.length) return out;
  const { accountLinks } = schema;
  const links = await db
    .select({ labelOrgId: accountLinks.labelOrgId })
    .from(accountLinks)
    .where(or(inArray(accountLinks.labelOrgId, orgIds), inArray(accountLinks.bandOrgId, orgIds)));
  const labels = [...new Set(links.map((l) => l.labelOrgId))];
  for (const l of labels) out.add(l);
  if (labels.length) {
    const bands = await db.select({ bandOrgId: accountLinks.bandOrgId }).from(accountLinks).where(inArray(accountLinks.labelOrgId, labels));
    for (const b of bands) if (b.bandOrgId) out.add(b.bandOrgId);
  }
  return out;
}
