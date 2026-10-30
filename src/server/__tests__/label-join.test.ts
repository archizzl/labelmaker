import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { newAccount, testDb } from "../../../test/helpers/db";

let orgId = "";
vi.mock("../context", () => ({
  requireAccess: async () => ({ orgId, org: { kind: "label" } }),
  requireAdmin: async () => ({ orgId }),
  getContext: async () => ({ orgId }),
  accountContext: async () => ({ orgId }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("redirect"), { to });
  },
}));

let db: Awaited<ReturnType<typeof testDb>>["db"];
let schema: Awaited<ReturnType<typeof testDb>>["schema"];
let links: typeof import("../band-invite-links");
let join: typeof import("../label-join");
let data: typeof import("../data");
let actions: typeof import("../actions");
let own: typeof import("../own-books");
let browse: typeof import("../sales-browse");
let bandPay: typeof import("../band-payout-actions");

beforeAll(async () => {
  ({ db, schema } = await testDb());
  links = await import("../band-invite-links");
  join = await import("../label-join");
  data = await import("../data");
  actions = await import("../actions");
  own = await import("../own-books");
  browse = await import("../sales-browse");
  bandPay = await import("../band-payout-actions");
});

async function login() {
  const id = randomUUID();
  await db.insert(schema.user).values({ id, name: "Ana", email: `${id}@example.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
  return id;
}

const today = new Date().toISOString().slice(0, 10);

async function sale(org: string, key: string, date: string, bandId: number | null, netCents = 1000) {
  const [imp] = await db.insert(schema.imports).values({ orgId: org, filename: "t", rowCount: 1, addedCount: 1, duplicateCount: 0 }).returning();
  await db.insert(schema.sales).values({
    orgId: org,
    importId: imp.id,
    dedupeKey: key,
    date,
    itemType: "album",
    category: "album",
    itemName: key,
    artist: "",
    itemUrl: "",
    packageName: "",
    currency: "USD",
    netCents,
    transactionId: key,
    routingKey: key,
    bandId,
    raw: {},
  });
}

/** A label, and a band's own group (run by `admin`) with two members and its own band. */
async function setup() {
  const labelOrgId = await newAccount("Collective");
  const bandOrgId = await newAccount("Glass Harbor", "band");
  const admin = await login();
  await db.insert(schema.member).values({ id: randomUUID(), organizationId: bandOrgId, userId: admin, role: "owner", createdAt: new Date() });
  const [own] = await db.insert(schema.bands).values({ orgId: bandOrgId, name: "Glass Harbor", urlPatterns: ["glassharbor"] }).returning();
  const [ana, ben] = await db
    .insert(schema.people)
    .values([
      { orgId: bandOrgId, name: "Ana", paypalMe: "ana" },
      { orgId: bandOrgId, name: "Ben" },
    ])
    .returning();
  await db.insert(schema.bandMemberships).values([
    { orgId: bandOrgId, bandId: own.id, personId: ana.id, roles: ["drums"] },
    { orgId: bandOrgId, bandId: own.id, personId: ben.id, roles: [], active: false },
  ]);
  return { labelOrgId, bandOrgId, admin, own, ana };
}

describe("a label's invite link for bands", () => {
  it("is its own link: not the label's link for people", async () => {
    const labelOrgId = await newAccount();
    const forBands = await links.bandsInviteLink(labelOrgId, null);
    expect(await links.bandsInviteLink(labelOrgId, null)).toBe(forBands);
    expect(await links.standingInviteLink(labelOrgId, null)).not.toBe(forBands);
    expect(await links.usableInviteLink(forBands)).toBeNull();
    expect((await links.usableBandsLink(forBands))?.label.id).toBe(labelOrgId);

    const fresh = await links.resetBandsInviteLink(labelOrgId, null);
    expect(fresh).not.toBe(forBands);
    expect(await links.usableBandsLink(forBands)).toBeNull();
  });

  it("offers the band groups someone runs, saying why one can't join", async () => {
    const { labelOrgId, bandOrgId, admin } = await setup();
    expect(await links.groupsToJoinWith(admin, labelOrgId)).toEqual([{ id: bandOrgId, name: "Glass Harbor", why: null }]);
    await join.joinLabel(labelOrgId, bandOrgId, null);
    expect((await links.groupsToJoinWith(admin, labelOrgId))[0].why).toBe("already on this label");
    expect((await links.groupsToJoinWith(admin, await newAccount("Other label")))[0].why).toBe("on another label");
  });
});

describe("joining a label", () => {
  it("puts the band and its current members in the label's books, Bandcamp paying the band", async () => {
    const { labelOrgId, bandOrgId, ana } = await setup();
    const { bandId } = await join.joinLabel(labelOrgId, bandOrgId, null);

    const [band] = await db.select().from(schema.bands).where(eq(schema.bands.id, bandId));
    expect(band).toMatchObject({ orgId: labelOrgId, name: "Glass Harbor", paidTo: "band", urlPatterns: ["glassharbor"] });
    const [link] = await db.select().from(schema.accountLinks).where(eq(schema.accountLinks.labelBandId, bandId));
    expect(link).toMatchObject({ bandOrgId, status: "active", managed: false, joined: true });

    const members = await db
      .select({ person: schema.people, roles: schema.bandMemberships.roles })
      .from(schema.bandMemberships)
      .innerJoin(schema.people, eq(schema.people.id, schema.bandMemberships.personId))
      .where(and(eq(schema.bandMemberships.orgId, labelOrgId), eq(schema.bandMemberships.bandId, bandId)));
    expect(members).toMatchObject([{ person: { name: "Ana", paypalMe: "ana" }, roles: ["drums"] }]);
    // The same person in both books.
    const [mine] = await db.select().from(schema.people).where(eq(schema.people.id, ana.id));
    expect(mine.labelPersonId).toBe(members[0].person.id);
  });

  it("sends the band's sales from then on to the label's books, and keeps the ones from before", async () => {
    const { labelOrgId, bandOrgId, own } = await setup();
    await sale(bandOrgId, "before", "2020-01-01", own.id);
    const { bandId } = await join.joinLabel(labelOrgId, bandOrgId, null);
    await sale(bandOrgId, "after", today, own.id);
    expect(await (await import("../own-books")).moveSalesToLabel(bandOrgId)).toBe(1);

    const rows = await db.select({ key: schema.sales.dedupeKey, orgId: schema.sales.orgId, bandId: schema.sales.bandId }).from(schema.sales);
    expect(rows.find((r) => r.key === "before")).toMatchObject({ orgId: bandOrgId, bandId: own.id });
    expect(rows.find((r) => r.key === "after")).toMatchObject({ orgId: labelOrgId, bandId });
  });
});

describe("a band Bandcamp pays itself", () => {
  /** A label with a 20% cut; its band is paid by Bandcamp directly. One $10 sale. */
  async function paidBand() {
    orgId = await newAccount();
    const [band] = await db.insert(schema.bands).values({ orgId, name: "Glass Harbor", paidTo: "band" }).returning();
    const [other] = await db.insert(schema.bands).values({ orgId, name: "Flag Day" }).returning();
    const [ana] = await db.insert(schema.people).values({ orgId, name: "Ana" }).returning();
    for (const b of [band, other]) {
      const [rule] = await db.insert(schema.splitRules).values({ orgId, scope: "band_default", bandId: b.id }).returning();
      await db.insert(schema.splitShares).values({ orgId, ruleId: rule.id, personId: ana.id, bps: 10000 });
    }
    await db.insert(schema.deductions).values({ orgId, label: "Label cut", kind: "percent", percentBps: 2000, destination: "label" });
    await sale(orgId, `gh-${orgId}`, "2026-01-10", band.id);
    await sale(orgId, `fd-${orgId}`, "2026-01-10", other.id);
    return { band, other, ana };
  }

  it("pays its members its part of a payout, on a line of its own", async () => {
    const { band, ana } = await paidBand();
    const fd = new FormData();
    fd.set("startDate", "2026-01-01");
    fd.set("endDate", "2026-01-31");
    await actions.finalizePayout(null, fd).catch(() => {});
    const lines = await db.select().from(schema.payouts).where(eq(schema.payouts.orgId, orgId));
    expect(lines.map((l) => ({ personId: l.personId, cents: l.amountCents, by: l.paidByBandId })).sort((a, b) => (a.by ?? 0) - (b.by ?? 0))).toEqual([
      { personId: ana.id, cents: 800, by: null },
      { personId: ana.id, cents: 800, by: band.id },
    ]);
  });

  it("holds the label's share until it sends it", async () => {
    const { band } = await paidBand();
    let funds = await data.labelFunds(orgId);
    expect(funds.kept.get("USD")).toBe(400);
    expect(funds.balance.get("USD")).toBe(200);
    expect(funds.heldByBands).toMatchObject([{ bandId: band.id }]);
    expect(funds.heldByBands[0].held.get("USD")).toBe(200);

    const fd = new FormData();
    for (const [k, v] of Object.entries({ bandId: String(band.id), amount: "1.50", currency: "USD", date: "2026-02-01" })) fd.set(k, v);
    expect(await actions.saveBandRemittance(null, fd)).toEqual({ ok: "Saved" });
    funds = await data.labelFunds(orgId);
    expect(funds.balance.get("USD")).toBe(350);
    expect(funds.heldByBands[0].held.get("USD")).toBe(50);
  });
});

describe("a band that joined, later on", () => {
  it("runs its own members: the label's books follow", async () => {
    const { labelOrgId, bandOrgId, own: band, ana } = await setup();
    const { bandId } = await join.joinLabel(labelOrgId, bandOrgId, null);
    const [cy] = await db.insert(schema.people).values({ orgId: bandOrgId, name: "Cy", venmo: "cy" }).returning();
    await db.insert(schema.bandMemberships).values({ orgId: bandOrgId, bandId: band.id, personId: cy.id, roles: ["keys"] });
    await db.delete(schema.bandMemberships).where(eq(schema.bandMemberships.personId, ana.id));
    await own.syncJoinedPeople(bandOrgId);

    const there = await db
      .select({ name: schema.people.name, roles: schema.bandMemberships.roles, active: schema.bandMemberships.active })
      .from(schema.bandMemberships)
      .innerJoin(schema.people, eq(schema.people.id, schema.bandMemberships.personId))
      .where(and(eq(schema.bandMemberships.orgId, labelOrgId), eq(schema.bandMemberships.bandId, bandId)));
    expect(there.sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: "Ana", roles: ["drums"], active: false },
      { name: "Cy", roles: ["keys"], active: true },
    ]);
  });

  it("brings its catalog and splits to the label", async () => {
    const { labelOrgId, bandOrgId, own: band, ana } = await setup();
    const [lp] = await db.insert(schema.releases).values({ orgId: bandOrgId, bandId: band.id, title: "First LP", bandcampId: 42, url: "https://glassharbor.bandcamp.com/album/first-lp" }).returning();
    await db.insert(schema.tracks).values({ orgId: bandOrgId, releaseId: lp.id, bandId: band.id, title: "Opener" });
    const [rule] = await db.insert(schema.splitRules).values({ orgId: bandOrgId, scope: "band_default", bandId: band.id }).returning();
    await db.insert(schema.splitShares).values({ orgId: bandOrgId, ruleId: rule.id, personId: ana.id, bps: 10000 });
    const { bandId } = await join.joinLabel(labelOrgId, bandOrgId, null);

    const [copy] = await db.select().from(schema.releases).where(eq(schema.releases.orgId, labelOrgId));
    expect(copy).toMatchObject({ bandId, title: "First LP", bandcampId: 42 });
    expect(await db.select({ title: schema.tracks.title, bandId: schema.tracks.bandId }).from(schema.tracks).where(eq(schema.tracks.releaseId, copy.id))).toEqual([
      { title: "Opener", bandId },
    ]);
    const [split] = await db.select().from(schema.splitRules).where(eq(schema.splitRules.orgId, labelOrgId));
    expect(split).toMatchObject({ scope: "band_default", bandId });
    const [share] = await db.select().from(schema.splitShares).where(eq(schema.splitShares.ruleId, split.id));
    const [mine] = await db.select().from(schema.people).where(eq(schema.people.id, ana.id));
    expect(share).toMatchObject({ personId: mine.labelPersonId, bps: 10000 });
  });

  it("still sees every sale of its own, saying who Bandcamp paid", async () => {
    const { labelOrgId, bandOrgId, own: band } = await setup();
    await sale(bandOrgId, `old-${bandOrgId}`, "2020-01-01", band.id);
    await join.joinLabel(labelOrgId, bandOrgId, null);
    await sale(bandOrgId, `new-${bandOrgId}`, today, band.id);
    await own.moveSalesToLabel(bandOrgId);

    const books = await browse.salesBooksFor(bandOrgId);
    expect(books).toMatchObject({ own: bandOrgId, labels: [{ orgId: labelOrgId, name: "Collective", paidTo: "band" }] });
    const page = await browse.browseSales(books, browse.parseSalesFilter({}));
    expect(page.rows.map((r) => [r.orgId, r.paidTo])).toEqual([
      [labelOrgId, "band"],
      [bandOrgId, "label"],
    ]);
  });

  it("marks its members paid, and records what it sent the label", async () => {
    const { labelOrgId, bandOrgId } = await setup();
    const { bandId } = await join.joinLabel(labelOrgId, bandOrgId, null);
    const [person] = await db.insert(schema.people).values({ orgId: labelOrgId, name: "Payee" }).returning();
    const [period] = await db.insert(schema.periods).values({ orgId: labelOrgId, name: "P", startDate: "2026-01-01", endDate: "2026-01-31" }).returning();
    const [line] = await db
      .insert(schema.payouts)
      .values({ orgId: labelOrgId, periodId: period.id, personId: person.id, currency: "USD", amountCents: 800, byBand: { [bandId]: 800 }, paidByBandId: bandId })
      .returning();

    orgId = bandOrgId;
    const fd = new FormData();
    fd.set("id", String(line.id));
    fd.set("status", "paid");
    await bandPay.markBandPayout(fd);
    const [after] = await db.select().from(schema.payouts).where(eq(schema.payouts.id, line.id));
    expect(after.status).toBe("paid");
    const [p] = await db.select().from(schema.periods).where(eq(schema.periods.id, period.id));
    expect(p.status).toBe("paid");

    const [link] = await db.select().from(schema.accountLinks).where(eq(schema.accountLinks.labelBandId, bandId));
    const sent = new FormData();
    for (const [k, v] of Object.entries({ linkId: String(link.id), amount: "2.00", date: "2026-02-01" })) sent.set(k, v);
    expect(await bandPay.recordPaymentToLabel(null, sent)).toEqual({ ok: "Saved" });
    expect(await db.select({ cents: schema.bandRemittances.amountCents }).from(schema.bandRemittances).where(eq(schema.bandRemittances.bandId, bandId))).toEqual([{ cents: 200 }]);

    // Not a label it's on: nothing.
    orgId = await newAccount("Someone else", "band");
    await expect(bandPay.markBandPayout(fd)).rejects.toThrow();
  });
});

describe("a joined band's changes reach the label straight away", () => {
  it("someone deleted from the band's books is a former member in the label's", async () => {
    const { labelOrgId, bandOrgId, ana } = await setup();
    const { bandId } = await join.joinLabel(labelOrgId, bandOrgId, null);
    const [mine] = await db.select().from(schema.people).where(eq(schema.people.id, ana.id));
    await db.delete(schema.people).where(eq(schema.people.id, ana.id));
    await own.syncPeopleAcrossBooks(bandOrgId, [mine.labelPersonId!]);
    const [there] = await db
      .select({ active: schema.bandMemberships.active })
      .from(schema.bandMemberships)
      .where(and(eq(schema.bandMemberships.bandId, bandId), eq(schema.bandMemberships.personId, mine.labelPersonId!)));
    expect(there.active).toBe(false);
  });

  it("a renamed band is renamed in the label's books, its old name kept as another spelling", async () => {
    const { labelOrgId, bandOrgId } = await setup();
    const { bandId } = await join.joinLabel(labelOrgId, bandOrgId, null);
    await own.renameJoinedBand(bandOrgId, "Glass Harbour");
    const [band] = await db.select().from(schema.bands).where(eq(schema.bands.id, bandId));
    expect(band).toMatchObject({ name: "Glass Harbour", aliases: ["Glass Harbor"] });
  });

  it("someone's own details (from Account) are the label's too", async () => {
    const { labelOrgId, bandOrgId, admin, ana } = await setup();
    await db.update(schema.people).set({ userId: admin }).where(eq(schema.people.id, ana.id));
    await join.joinLabel(labelOrgId, bandOrgId, null);
    await (await import("../people")).applyMyDetails(admin, { paypalMe: "ana-new" });
    const [mine] = await db.select().from(schema.people).where(eq(schema.people.id, ana.id));
    const [there] = await db.select().from(schema.people).where(eq(schema.people.id, mine.labelPersonId!));
    expect(there.paypalMe).toBe("ana-new");
  });
});
