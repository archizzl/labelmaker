import { ActionForm, SaveWhenChanged, SubmitButton } from "@/components/client";
import { Card, Disclosure, Empty, Field, Money, Stat } from "@/components/ui";
import { can } from "@/lib/permissions";
import { db, schema } from "@/db";
import { centsToDecimal } from "@/lib/money";
import { deleteLabelTransferForm, saveLabelTransfer } from "@/server/actions";
import { eq } from "drizzle-orm";
import { getContext } from "@/server/context";
import { labelFunds, nameMaps } from "@/server/data";
import { incomeSources, labelIncome } from "@/server/label-income";
import { SentTo } from "./pay-person";
import { type SourceInfo, SourceSelect } from "./source-select";
import { formatDate } from "@/lib/dates";

type Transfer = typeof schema.labelTransfers.$inferSelect;

/** The money-sent-out rows' columns (on a phone, one under another): with and without "how". */
const TRANSFER_COLUMNS = "grid gap-x-3 gap-y-1 sm:grid-cols-[6rem_minmax(0,1.3fr)_minmax(0,1.2fr)_minmax(5rem,auto)_2.5rem]";
const TRANSFER_COLUMNS_HOW = "grid gap-x-3 gap-y-1 sm:grid-cols-[6rem_minmax(0,1.3fr)_minmax(0,1.2fr)_minmax(5rem,auto)_minmax(0,1fr)_2.5rem]";

async function TransferForm({ transfer, bandId, sources }: { transfer?: Transfer; bandId?: number; sources: SourceInfo[] }) {
  const { orgId } = await getContext();
  const [bands, releases, payees] = await Promise.all([
    db.select().from(schema.bands).where(eq(schema.bands.orgId, orgId)).orderBy(schema.bands.name),
    db.select().from(schema.releases).where(eq(schema.releases.orgId, orgId)).orderBy(schema.releases.title),
    db
      .select({ id: schema.people.id, name: schema.people.name, paypalMe: schema.people.paypalMe, venmo: schema.people.venmo, cashtag: schema.people.cashtag })
      .from(schema.people)
      .where(eq(schema.people.orgId, orgId))
      .orderBy(schema.people.name),
  ]);
  // Keep a source that's since been renamed or removed selectable when editing.
  const sourceOptions: SourceInfo[] =
    transfer?.source && !sources.some((x) => x.label === transfer.source)
      ? [...sources, { label: transfer.source, bandId: null, releaseId: null, remainingCents: null, currency: null, lastRecipient: null, lastMethod: null }]
      : sources;
  const today = new Date().toLocaleDateString("en-CA"); // local yyyy-mm-dd
  const forBand = transfer?.bandId ?? bandId ?? null;
  return (
    <ActionForm action={saveLabelTransfer} className="grid gap-4 sm:grid-cols-3">
      {transfer && <input type="hidden" name="id" value={transfer.id} />}
      <SentTo people={payees} defaultPersonId={transfer?.personId ?? null} defaultRecipient={transfer?.recipient} />
      <Field label="Amount">
        <span className="flex gap-2">
          <input name="amount" required inputMode="decimal" defaultValue={transfer ? centsToDecimal(transfer.amountCents) : ""} placeholder="250.00" />
          <input name="currency" defaultValue={transfer?.currency ?? "USD"} className="!w-20" aria-label="Currency" />
        </span>
      </Field>
      <Field label="Date sent">
        <input name="date" type="date" required defaultValue={transfer?.date ?? today} />
      </Field>
      <Field label="From (optional)">
        <SourceSelect sources={sourceOptions} defaultValue={transfer?.source ?? ""} />
      </Field>
      <Field label="Raised by (optional)">
        <select name="bandId" defaultValue={forBand ?? ""}>
          <option value="">Not tied to a band</option>
          {bands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="From release (optional)">
        <select name="releaseId" defaultValue={transfer?.releaseId ?? ""}>
          <option value="">No specific release</option>
          {bands
            .filter((b) => !bandId || b.id === bandId)
            .map((b) => (
              <optgroup key={b.id} label={b.name}>
                {releases
                  .filter((r) => r.bandId === b.id)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.title}
                    </option>
                  ))}
              </optgroup>
            ))}
        </select>
      </Field>
      <Field label="How (optional)">
        <input name="method" list="transfer-methods" defaultValue={transfer?.method ?? ""} placeholder="Bank transfer" />
      </Field>
      <Field label="Reference (optional)" hint="Transaction or check number.">
        <input name="reference" defaultValue={transfer?.reference ?? ""} />
      </Field>
      <Field label="Note (optional)" className="sm:col-span-2">
        <input name="note" defaultValue={transfer?.note ?? ""} placeholder="Proceeds from the benefit show livestream" />
      </Field>
      <datalist id="transfer-methods">
        <option value="Bank transfer" />
        <option value="PayPal" />
        <option value="Check" />
        <option value="Venmo" />
        <option value="Cash" />
      </datalist>
      <div className="sm:col-span-3">
        {transfer ? (
          <SaveWhenChanged>
            <SubmitButton>Save</SubmitButton>
          </SaveWhenChanged>
        ) : (
          <SubmitButton>Record it</SubmitButton>
        )}
      </div>
    </ActionForm>
  );
}

/** Each income source, with what picking it can fill in: what's still there, and who it went to last time. */
async function sourceDetails(orgId: string): Promise<SourceInfo[]> {
  const [sources, income, transfers] = await Promise.all([
    incomeSources(orgId),
    labelIncome(orgId),
    db.select().from(schema.labelTransfers).where(eq(schema.labelTransfers.orgId, orgId)),
  ]);
  const cur = income.currencies[0] ?? "USD";
  const latest = [...transfers].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  return sources.map((s) => {
    const last = latest.find((t) => t.source === s.label);
    const came = income.bySource.get(s.label)?.get(cur) ?? 0;
    const sent = income.sentBySource.get(s.label)?.get(cur) ?? 0;
    return {
      ...s,
      remainingCents: came ? came - sent : null,
      currency: cur,
      lastRecipient: last?.recipient ?? null,
      lastMethod: last?.method ?? null,
    };
  });
}

/**
 * The label's own money and where it went: kept from sales, sent on to others (fundraisers,
 * donations), and what's left. With `bandId`, only transfers raised by that band (named by release
 * alone: the band's already the page's).
 */
export async function LabelFunds({ bandId, showTotals = true }: { bandId?: number; showTotals?: boolean }) {
  const { orgId, access } = await getContext();
  const editable = can(access, "funds", "edit");
  const [funds, names, sources] = await Promise.all([labelFunds(orgId), nameMaps(orgId), sourceDetails(orgId)]);
  const transfers = bandId ? funds.transfers.filter((t) => t.bandId === bandId) : funds.transfers;
  const causeName = (c: { bandId: number | null; releaseId: number | null }) =>
    (bandId && c.releaseId
      ? [names.release.get(c.releaseId)]
      : [c.bandId && names.band.get(c.bandId), c.releaseId && names.release.get(c.releaseId)]
    )
      .filter(Boolean)
      .join(" · ");
  // No "How" column when nothing sent says how.
  const anyHow = transfers.some((t) => t.method || t.reference);
  const currencies = [...funds.balance.keys()].sort();

  return (
    <Card title={bandId ? "Label funds sent on" : showTotals ? "Label funds" : "Sent on to others"}>
      {/* <p className="mb-4 text-sm text-muted">
        {bandId || !showTotals
          ? "Money the label kept from sales and then passed on to someone else."
          : "What the label kept from sales (its cut, label releases, anything routed to it like a fundraiser), what it passed on to others or spent (expenses it paid, people it reimbursed; see Receipts), and what’s left in its account."}
      </p> */}

      {!bandId &&
        showTotals &&
        currencies.map((cur) => (
          <div key={cur} className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label={`Kept by the label${currencies.length > 1 ? ` (${cur})` : ""}`} value={<Money cents={funds.kept.get(cur) ?? 0} currency={cur} />} />
            <Stat label="Sent on to others" value={<Money cents={funds.sent.get(cur) ?? 0} currency={cur} />} />
            <Stat label="Spent on expenses" value={<Money cents={funds.spent.get(cur) ?? 0} currency={cur} />} />
            <Stat label="Left in the label’s bank account" value={<Money cents={funds.balance.get(cur) ?? 0} currency={cur} />} tone="accent" />
          </div>
        ))}

      {transfers.length === 0 ? (
        <Empty>Nothing sent out yet.</Empty>
      ) : (
        // Rows open full-width to edit, as in the Directory.
        <div className="text-sm">
          <div className={`${anyHow ? TRANSFER_COLUMNS_HOW : TRANSFER_COLUMNS} hidden border-b border-border px-2.5 py-1.5 text-xs text-muted lowercase sm:grid`}>
            <span>date</span>
            <span>sent to</span>
            <span>from</span>
            <span className="text-right">amount</span>
            {anyHow && <span>how</span>}
            <span />
          </div>
          {transfers.map((t) => {
            const cells = (
              <>
                <span className="whitespace-nowrap text-muted">{formatDate(t.date)}</span>
                <span className="block min-w-0">
                  <span className="block font-medium">{t.recipient}</span>
                  {t.note && <span className="block text-xs text-muted">{t.note}</span>}
                </span>
                <span className="block min-w-0">
                  {t.source ?? (causeName(t) ? null : <span className="text-muted">—</span>)}
                  {/* (Not when the source's name already says it.) */}
                  {causeName(t) && !t.source?.includes(causeName(t)) && <span className={`block ${t.source ? "text-xs text-muted" : ""}`}>{causeName(t)}</span>}
                </span>
                <span className="font-medium tabular-nums sm:text-right">
                  <Money cents={t.amountCents} currency={t.currency} />
                </span>
                {anyHow && <span className="text-xs text-muted">{[t.method, t.reference].filter(Boolean).join(" · ") || "—"}</span>}
              </>
            );
            const columns = anyHow ? TRANSFER_COLUMNS_HOW : TRANSFER_COLUMNS;
            if (!editable) {
              return (
                <div key={t.id} className={`${columns} items-start border-b border-border px-2.5 py-2`}>
                  {cells}
                  <span />
                </div>
              );
            }
            return (
              <details key={t.id} className="group/row border-b border-border">
                <summary className={`${columns} items-start px-2.5 py-2 hover:bg-surface-2`}>
                  {cells}
                  <span className="text-right text-xs text-link">
                    <span className="group-open/row:hidden">edit</span>
                    <span className="hidden group-open/row:inline">close</span>
                  </span>
                </summary>
                <div className="mb-3 space-y-4 border border-border bg-surface-2 p-4">
                  <TransferForm transfer={t} sources={sources} />
                  <ActionForm action={deleteLabelTransferForm} className="border-t border-border pt-4">
                    <input type="hidden" name="id" value={t.id} />
                    <SubmitButton variant="danger" size="sm" confirm={`Delete the ${centsToDecimal(t.amountCents)} ${t.currency} sent to ${t.recipient}?`}>
                      Delete
                    </SubmitButton>
                  </ActionForm>
                </div>
              </details>
            );
          })}
        </div>
      )}
      {editable && (
        <div className="mt-4">
          <Disclosure summary="+ Record money sent out">
            <TransferForm bandId={bandId} sources={sources} />
          </Disclosure>
        </div>
      )}
    </Card>
  );
}
