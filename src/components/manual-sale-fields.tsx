"use client";

import { useEffect, useRef, useState } from "react";
import { Field } from "@/components/ui";
import { MANUAL_KINDS, PAYMENT_METHODS, SHOW_DETAILS } from "@/lib/manual-sales";
import { formatCents, parseCents } from "@/lib/money";

/** A merch item that can be sold by hand: "<release id>:<package id>" (or just "<release id>:"), its band and price. */
export type MerchChoice = { value: string; label: string; bandId: number | null; price: number | null };

/** A show detail's label. */
const detail = (name: (typeof SHOW_DETAILS)[number]["name"]) => SHOW_DETAILS.find((d) => d.name === name)!.label;

/**
 * The hand-added sale's band (a choice only when there's more than one), what it was and how it was
 * paid (cash is left out of payouts unless unticked). A show is one amount, with its ticket sales and
 * where it was if wanted; anything else is one amount and a quantity; merch is every merch item the
 * band has, each with its price and how many were sold (and a line for anything not in the catalog).
 */
export function ManualSaleFields({ bands, merch, currency }: { bands: { id: number; name: string }[]; merch: MerchChoice[]; currency: string }) {
  const [bandId, setBandId] = useState(bands.length === 1 ? String(bands[0].id) : "");
  const [kind, setKind] = useState<string>("merch");
  const [paidWith, setPaidWith] = useState<string>(PAYMENT_METHODS[0]);
  const [outside, setOutside] = useState(false);
  const [tickets, setTickets] = useState("");
  const [ticketPrice, setTicketPrice] = useState("");
  // The form resets itself after each add, which puts the selects back to their first choice: put
  // them back to what's showing (the next sale is likely the same kind, paid the same way).
  const kindSelect = useRef<HTMLSelectElement>(null);
  const paidSelect = useRef<HTMLSelectElement>(null);
  const outsideBox = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const form = kindSelect.current?.form;
    if (!form) return;
    const restore = () =>
      setTimeout(() => {
        if (kindSelect.current) kindSelect.current.value = kind;
        if (paidSelect.current) paidSelect.current.value = paidWith;
        if (outsideBox.current) outsideBox.current.checked = outside;
        setTickets("");
        setTicketPrice("");
      });
    form.addEventListener("reset", restore);
    return () => form.removeEventListener("reset", restore);
  }, [kind, paidWith, outside]);
  const ticketTotal = (Number(tickets) || 0) * parseCents(ticketPrice);
  const items = merch.filter((m) => !bandId || m.bandId === null || String(m.bandId) === bandId);
  return (
    <>
      {bands.length === 1 ? (
        <input type="hidden" name="bandId" value={bands[0].id} />
      ) : (
        <Field label="Band">
          <select name="bandId" required value={bandId} onChange={(e) => setBandId(e.target.value)}>
            <option value="" disabled>
              Choose a band
            </option>
            {bands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {/* What's sent is what's shown (the form resets itself after each add, but this stays). */}
      <input type="hidden" name="kind" value={kind} />
      <Field label="What it was">
        <select ref={kindSelect} value={kind} onChange={(e) => setKind(e.target.value)}>
          {MANUAL_KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Currency">
        <input name="currency" required defaultValue={currency} maxLength={3} className="uppercase" />
      </Field>
      <input type="hidden" name="paidWith" value={paidWith} />
      <Field label="Paid with">
        <select
          ref={paidSelect}
          value={paidWith}
          onChange={(e) => {
            setPaidWith(e.target.value);
            setOutside(e.target.value === "Cash");
          }}
        >
          {PAYMENT_METHODS.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      </Field>
      <input type="hidden" name="outsidePayouts" value={outside ? "1" : "0"} />
      <label className="flex items-end gap-2 pb-2 text-sm sm:col-span-2">
        <input ref={outsideBox} type="checkbox" checked={outside} onChange={(e) => setOutside(e.target.checked)} className="mb-0.5" />
        Leave out of payouts: the money’s already been shared out
      </label>
      {kind === "merch" ? (
        // A new band's list starts empty.
        <div key={bandId} className="overflow-x-auto sm:col-span-3">
          <table className="data">
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">Each</th>
                <th className="num">Sold</th>
              </tr>
            </thead>
            <tbody>
              {items.map((m) => (
                <tr key={m.value}>
                  <td>{m.label}</td>
                  <td className="num">
                    <input name={`each:${m.value}`} inputMode="decimal" defaultValue={m.price?.toFixed(2) ?? ""} aria-label={`${m.label}: price each`} className="!w-24 text-right" />
                  </td>
                  <td className="num">
                    <input name={`sold:${m.value}`} type="number" min={0} placeholder="0" aria-label={`${m.label}: how many sold`} className="!w-20 text-right" />
                  </td>
                </tr>
              ))}
              <tr>
                <td>
                  <input name="name:other" maxLength={200} placeholder="Something else" aria-label="Something else: what it was" />
                </td>
                <td className="num">
                  <input name="each:other" inputMode="decimal" aria-label="Something else: price each" className="!w-24 text-right" />
                </td>
                <td className="num">
                  <input name="sold:other" type="number" min={0} placeholder="0" aria-label="Something else: how many sold" className="!w-20 text-right" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : kind === "show" ? (
        <>
          <Field label="Show" className="sm:col-span-3">
            <input name="itemName" required maxLength={200} />
          </Field>
          <Field label={detail("venue")}>
            <input name="venue" maxLength={200} />
          </Field>
          <Field label={detail("city")}>
            <input name="city" maxLength={200} />
          </Field>
          <Field label={detail("promoter")}>
            <input name="promoter" maxLength={200} />
          </Field>
          <Field label={detail("capacity")}>
            <input name="capacity" type="number" min={0} />
          </Field>
          <Field label={detail("tickets")}>
            <input name="tickets" type="number" min={0} value={tickets} onChange={(e) => setTickets(e.target.value)} />
          </Field>
          <Field label={detail("ticketPrice")}>
            <input name="ticketPrice" inputMode="decimal" value={ticketPrice} onChange={(e) => setTicketPrice(e.target.value)} />
          </Field>
          <Field label="Amount received">
            {/* Left blank, it's the tickets sold times their price. */}
            <input name="amount" required={!ticketTotal} inputMode="decimal" placeholder={ticketTotal ? formatCents(ticketTotal, currency) : undefined} />
          </Field>
          <Field label={detail("notes")} className="sm:col-span-2">
            <input name="notes" maxLength={1000} />
          </Field>
        </>
      ) : (
        <>
          <Field label="Description" className="sm:col-span-3">
            <input name="itemName" required maxLength={200} />
          </Field>
          <Field label="Amount received">
            <input name="amount" required inputMode="decimal" />
          </Field>
          <Field label="Quantity">
            <input name="quantity" type="number" min={1} defaultValue={1} />
          </Field>
        </>
      )}
    </>
  );
}
