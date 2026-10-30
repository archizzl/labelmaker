import { and, desc, eq } from "drizzle-orm";
import { ActionForm, SubmitButton } from "@/components/client";
import { Card, Disclosure, Field, Money, MoneyList } from "@/components/ui";
import { db, schema } from "@/db";
import { markBandPayout, recordPaymentToLabel } from "@/server/band-payout-actions";
import { labelFunds } from "@/server/data";
import type { SalesLabel } from "@/server/sales-browse";

/**
 * A band that Bandcamp pays itself (bands.paidTo), on a label: what it sends, the label's share of its
 * sales and its members' part of the label's payouts, with what it has sent. Its admins mark members
 * paid and record what they sent the label. Nothing when Bandcamp pays the label.
 */
export async function BandSends({ label, editable }: { label: SalesLabel; editable: boolean }) {
  if (label.paidTo !== "band") return null;
  const [lines, sent, funds] = await Promise.all([
    db
      .select({ id: schema.payouts.id, name: schema.people.name, period: schema.periods.name, currency: schema.payouts.currency, cents: schema.payouts.amountCents })
      .from(schema.payouts)
      .innerJoin(schema.people, eq(schema.people.id, schema.payouts.personId))
      .innerJoin(schema.periods, eq(schema.periods.id, schema.payouts.periodId))
      .where(and(eq(schema.payouts.orgId, label.orgId), eq(schema.payouts.paidByBandId, label.bandId), eq(schema.payouts.status, "pending")))
      .orderBy(schema.periods.startDate, schema.people.name),
    db
      .select()
      .from(schema.bandRemittances)
      .where(and(eq(schema.bandRemittances.orgId, label.orgId), eq(schema.bandRemittances.bandId, label.bandId)))
      .orderBy(desc(schema.bandRemittances.date), desc(schema.bandRemittances.id))
      .limit(5),
    labelFunds(label.orgId),
  ]);
  const held = new Map([...(funds.heldByBands.find((h) => h.bandId === label.bandId)?.held ?? [])].filter(([, c]) => c > 0));
  const owing = lines.filter((l) => l.cents > 0);
  const today = new Date().toLocaleDateString("en-CA");
  return (
    <Card title={`What you send to ${label.name}`}>
      <p className="mb-3 text-sm">{held.size ? <>Its share: <MoneyList totals={held} /></> : "Nothing to send for its share."}</p>
      {owing.length === 0 ? (
        <p className="text-sm text-muted">No payouts for your members to send.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {owing.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-medium">{l.name}</span>
              <Money cents={l.cents} currency={l.currency} />
              <span className="text-xs text-muted">{l.period}</span>
              {editable && (
                <form action={markBandPayout} className="ml-auto flex items-center gap-2">
                  <input type="hidden" name="id" value={l.id} />
                  <input type="hidden" name="status" value="paid" />
                  <input name="reference" placeholder="Reference (optional)" className="!w-40 !py-1 !text-xs" />
                  <SubmitButton variant="secondary" size="sm">
                    Mark paid
                  </SubmitButton>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      {sent.length > 0 && (
        <ul className="mt-4 space-y-1 text-sm">
          {sent.map((r) => (
            <li key={r.id} className="flex flex-wrap gap-x-3">
              <span className="text-muted">{r.date}</span>
              <span>Sent to {label.name}</span>
              <Money cents={r.amountCents} currency={r.currency} />
              {r.note && <span className="text-xs text-muted">{r.note}</span>}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <div className="mt-4">
          <Disclosure summary={`+ Record money sent to ${label.name}`}>
            <ActionForm action={recordPaymentToLabel} className="grid gap-4 sm:grid-cols-3">
              <input type="hidden" name="linkId" value={label.linkId} />
              <Field label="Amount">
                <span className="flex gap-2">
                  <input name="amount" required inputMode="decimal" placeholder="250.00" />
                  <input name="currency" defaultValue={[...held.keys()][0] ?? "USD"} className="!w-20" aria-label="Currency" />
                </span>
              </Field>
              <Field label="Date sent">
                <input name="date" type="date" required defaultValue={today} />
              </Field>
              <Field label="Note (optional)">
                <input name="note" />
              </Field>
              <div className="sm:col-span-3">
                <SubmitButton>Save</SubmitButton>
              </div>
            </ActionForm>
          </Disclosure>
        </div>
      )}
    </Card>
  );
}
