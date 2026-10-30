import { and, eq } from "drizzle-orm";
import { EarningsStats } from "@/components/earnings-stats";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { ExpenseTable, expenseTotals } from "@/components/receipts";
import { SalesSection } from "@/components/sales-section";
import { BandPayouts } from "@/components/band-payouts";
import { Card, MoneyList, PageHeader } from "@/components/ui";
import { db, schema } from "@/db";
import { computePayoutPeriod, labelFunds, nameMaps } from "@/server/data";
import { accountExpenses, expenseFileList } from "@/server/expenses";
import { requireLinkedView } from "@/server/links";
import { projectsEnabled } from "@/server/features";
import { accountProjects } from "@/server/projects";
import { BandProjects } from "@/components/band-projects";

export const metadata = { title: "from label" };

/**
 * A band account's read-only view of its label's books for that band: sales through the label,
 * where the money went, payouts to its members, statements and receipts. Nothing here can be changed.
 */
export default async function FromLabelPage({ params, searchParams }: PageProps<"/from-label/[id]">) {
  await connection();
  const linkId = Number((await params).id);
  const v = await requireLinkedView(linkId);
  const { labelOrgId, bandId } = v;
  // A band account the label made: its dashboard has both its own books and the label's for it.
  if (v.link.managed) redirect("/");
  const [names, expenses, files, labelProjects] = await Promise.all([
    nameMaps(labelOrgId),
    accountExpenses(labelOrgId, { bandId }),
    expenseFileList(labelOrgId),
    projectsEnabled().then((on) => (on ? accountProjects(labelOrgId) : [])),
  ]);
  // A band's own account, linked: its login's earnings, matched by email.
  const mine = await myEarnings(labelOrgId, bandId, { email: v.ctx.user.email });
  const approved = expenses.filter((e) => e.status === "approved");

  return (
    <>
      <PageHeader title={v.bandName} />
      {/* <Callout tone="neutral">
        This is what {v.labelName} records for {v.bandName}. Only the label can change it; ask them if something looks wrong.
      </Callout> */}

      {mine && (
        <Card title="Your earnings">
          <div className="mb-4">
            <EarningsStats owed={mine.owed} received={mine.received} upcoming={mine.upcoming} />
          </div>
        </Card>
      )}

      <BandSends labelOrgId={labelOrgId} bandId={bandId} labelName={v.labelName} />

      <SalesSection
        boardId="label-sales"
        orgId={labelOrgId}
        scope={{ bandId }}
        range={(await searchParams).range as string | undefined}
        basePath={`/from-label/${linkId}`}
        readOnly
        showItems
        title="Sales through the label"
      />

      <BandPayouts labelOrgId={labelOrgId} bandId={bandId} bandName={v.bandName} statementHref={(id) => `/from-label/${linkId}/statement/${id}`} />

      <BandProjects labelOrgId={labelOrgId} bandId={bandId} />

      <Card title="Receipts">
        {approved.length > 0 && (
          <p className="mb-3 text-sm text-muted">
            Approved expenses for {v.bandName}: <MoneyList totals={expenseTotals(approved)} />
          </p>
        )}
        <ExpenseTable
          rows={expenses.filter((e) => e.status !== "rejected")}
          files={files}
          personName={(id) => names.person.get(id)}
          bandName={(id) => names.band.get(id)}
          projectName={(pid) => labelProjects.find((p) => p.id === pid)?.name}
          mode="readonly"
          groupName={v.labelName}
        />
      </Card>
    </>
  );
}

/**
 * When Bandcamp pays the band itself (bands.paidTo): what it sends, its members' part of the label's
 * payouts and the label's share of its sales. Nothing otherwise.
 */
async function BandSends({ labelOrgId, bandId, labelName }: { labelOrgId: string; bandId: number; labelName: string }) {
  const [[band], lines, funds] = await Promise.all([
    db
      .select({ paidTo: schema.bands.paidTo })
      .from(schema.bands)
      .where(and(eq(schema.bands.orgId, labelOrgId), eq(schema.bands.id, bandId))),
    db
      .select({ name: schema.people.name, currency: schema.payouts.currency, amountCents: schema.payouts.amountCents })
      .from(schema.payouts)
      .innerJoin(schema.people, eq(schema.people.id, schema.payouts.personId))
      .where(and(eq(schema.payouts.orgId, labelOrgId), eq(schema.payouts.paidByBandId, bandId), eq(schema.payouts.status, "pending"))),
    labelFunds(labelOrgId),
  ]);
  if (band?.paidTo !== "band") return null;
  const held = new Map([...(funds.heldByBands.find((h) => h.bandId === bandId)?.held ?? [])].filter(([, c]) => c > 0));
  const owed = new Map<string, { name: string; currency: string; cents: number }>();
  for (const l of lines) {
    if (l.amountCents <= 0) continue;
    const k = `${l.name}|${l.currency}`;
    const e = owed.get(k) ?? { name: l.name, currency: l.currency, cents: 0 };
    e.cents += l.amountCents;
    owed.set(k, e);
  }
  return (
    <Card title="What you send">
      <p className="mb-3 text-sm">
        {held.size ? (
          <>
            To {labelName}, its share: <MoneyList totals={held} />
          </>
        ) : (
          `Nothing to send to ${labelName}.`
        )}
      </p>
      {owed.size === 0 ? (
        <p className="text-sm text-muted">No payouts for your members to send.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {[...owed.values()].map((o) => (
            <li key={`${o.name}|${o.currency}`}>
              {o.name}: <MoneyList totals={new Map([[o.currency, o.cents]])} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * The signed-in person's own earnings in the label's books: the label's payee in this band with
 * their email. Null if there isn't one (or for a label admin viewing as the band).
 */
/** A member's earnings from the label for this band: the one picked (by id), or whoever has the login's email. */
async function myEarnings(labelOrgId: string, bandId: number, who: { id: number } | { email: string }) {
  if ("email" in who ? !who.email : !who.id) return null;
  const email = "email" in who ? who.email.trim().toLowerCase() : null;
  const [person] = (
    await db
      .select({ person: schema.people })
      .from(schema.bandMemberships)
      .innerJoin(schema.people, eq(schema.people.id, schema.bandMemberships.personId))
      .where(and(eq(schema.bandMemberships.orgId, labelOrgId), eq(schema.bandMemberships.bandId, bandId)))
  )
    .map((r) => r.person)
    .filter((p) => ("id" in who ? p.id === who.id : p.email?.trim().toLowerCase() === email));
  if (!person) return null;
  const [payoutRows, unpaid] = await Promise.all([
    db
      .select()
      .from(schema.payouts)
      .where(and(eq(schema.payouts.orgId, labelOrgId), eq(schema.payouts.personId, person.id))),
    computePayoutPeriod(labelOrgId, { id: 0, bandId, startDate: "0000-01-01", endDate: "9999-12-31" }),
  ]);
  // Just this band's part of each payout (someone in several bands is paid for all of them at once).
  const owed = new Map<string, number>();
  const received = new Map<string, number>();
  for (const p of payoutRows) {
    const part = p.byBand[String(bandId)] ?? 0;
    if (!part) continue;
    const m = p.status === "pending" ? owed : received;
    m.set(p.currency, (m.get(p.currency) ?? 0) + part);
  }
  const upcoming = new Map<string, number>();
  for (const cur of unpaid.summary.currencies) {
    const line = unpaid.summary.byCurrency[cur].byPerson.get(person.id);
    if (line?.total) upcoming.set(cur, line.total);
  }
  return { person, owed, received, upcoming };
}
