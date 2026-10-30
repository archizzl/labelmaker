import "server-only";
import { z } from "zod";
import { schema } from "@/db";
import {
  deleteBandRemittance,
  deleteLabelTransfer,
  releaseUnpaidSales,
  saveBandRemittance,
  saveLabelTransfer,
  setBandPaidTo,
  setLabelAccountHolder,
  setPayoutStatus,
  undoFinalize,
} from "../../actions";
import { markBandPayout, recordPaymentToLabel } from "../../band-payout-actions";
import { actionTool } from "../tool";
import { amount, current, currency, date, id, or, toAmount } from "./shared";

/* Payouts (besides making one and marking it all paid: write-tools.ts) and the label's funds. */

const payoutLineStatus = actionTool({
  name: "set_payout_line_status",
  label: "Mark one person's payout",
  description: "Mark one person's line in a finalized payout paid, kept in the label's account, or back to not paid (payout_detail has each line's id).",
  params: z.object({ payoutLineId: id, status: z.enum(["paid", "kept", "pending"]), reference: z.string().max(120).optional() }),
  needs: { area: "payouts", level: "edit" },
  items: { payoutLineId: "payout line" },
  action: (fd) => setPayoutStatus(fd),
  fields: (_ctx, a) => ({ id: a.payoutLineId, status: a.status, reference: a.reference }),
});

const undoPayout = actionTool({
  name: "undo_payout",
  label: "Undo a finalized payout",
  description: "Undo a finalized payout: its amounts and paid marks are removed and its sales are owed again.",
  params: z.object({ payoutId: id }),
  needs: { area: "payouts", level: "edit" },
  items: { payoutId: "payout" },
  action: (fd) => undoFinalize(fd),
  fields: (_ctx, a) => ({ id: a.payoutId }),
  done: "Payout undone.",
});

const releaseUnpaid = actionTool({
  name: "release_unpaid_sales",
  label: "Let go of a payout's unpaid sales",
  description: "For an older finalized payout that took in sales nobody was paid for: let go of those sales, so a later payout pays them.",
  params: z.object({ payoutId: id }),
  needs: { area: "payouts", level: "edit" },
  items: { payoutId: "payout" },
  action: (fd) => releaseUnpaidSales(fd),
  fields: (_ctx, a) => ({ id: a.payoutId }),
});

const saveSendOut = actionTool({
  name: "save_send_out",
  label: "Save money the label sent on",
  description:
    "Record money the label kept and sent on (a fundraiser's proceeds to an aid group, say), or change one (give its id; only the fields given change). label_funds lists them. source ties it to a deduction's name.",
  params: z.object({
    id: id.optional(),
    date: date.optional(),
    recipient: z.string().max(200).optional(),
    amount: amount.optional(),
    currency: currency.optional(),
    source: z.string().max(120).optional(),
    bandId: id.optional(),
    releaseId: id.optional(),
    personId: id.optional(),
    method: z.string().max(60).optional(),
    reference: z.string().max(120).optional(),
    note: z.string().max(500).optional(),
  }),
  needs: { area: "funds", level: "edit" },
  items: { id: "send-out" },
  action: (fd) => saveLabelTransfer(null, fd),
  fields: async (ctx, a) => {
    const t = a.id ? await current(schema.labelTransfers, ctx.orgId, a.id, "send-out") : null;
    return {
      id: a.id,
      date: or(a.date, t?.date),
      recipient: or(a.recipient, t?.recipient),
      amount: or(a.amount, toAmount(t?.amountCents)),
      currency: or(a.currency, t?.currency),
      source: or(a.source, t?.source ?? undefined),
      bandId: or(a.bandId, t?.bandId ?? undefined),
      releaseId: or(a.releaseId, t?.releaseId ?? undefined),
      personId: or(a.personId, t?.personId ?? undefined),
      method: or(a.method, t?.method ?? undefined),
      reference: or(a.reference, t?.reference ?? undefined),
      note: or(a.note, t?.note ?? undefined),
    };
  },
});

const deleteSendOut = actionTool({
  name: "delete_send_out",
  label: "Delete a record of money sent on",
  description: "Delete a record of money the label sent on (label_funds lists their ids).",
  params: z.object({ id }),
  needs: { area: "funds", level: "edit" },
  items: { id: "send-out" },
  action: (fd) => deleteLabelTransfer(fd),
});

const accountHolder = actionTool({
  name: "set_label_account_holder",
  label: "Set who holds the label's bank account",
  description:
    "Set who holds the label's bank account: their share of payouts stays there instead of being sent, and their unpaid payouts are marked kept. Leave out personId for nobody.",
  params: z.object({ personId: id.optional() }),
  needs: { area: "funds", level: "edit" },
  action: (fd) => setLabelAccountHolder(fd),
});

const bandPaidTo = actionTool({
  name: "set_band_paid_to",
  label: "Set who Bandcamp pays for a band",
  description:
    "Set who Bandcamp pays for a band's sales: the label, or the band itself (a band on the label but not on its Bandcamp). When it's the band, the band pays its members their part of each payout and sends the label its share. Finalized payouts stay as they are.",
  params: z.object({ bandId: id, paidTo: z.enum(["label", "band"]) }),
  needs: { area: "payouts", level: "edit" },
  action: (fd) => setBandPaidTo(fd),
});

const saveRemittance = actionTool({
  name: "record_band_remittance",
  label: "Record money a band sent the label",
  description: "Record money a band sent the label: its share of sales Bandcamp paid the band for (label_funds shows what each such band still holds).",
  params: z.object({ bandId: id, amount, currency: currency.optional(), date, note: z.string().max(500).optional() }),
  needs: { area: "funds", level: "edit" },
  action: (fd) => saveBandRemittance(null, fd),
});

const deleteRemittance = actionTool({
  name: "delete_band_remittance",
  label: "Delete a record of money a band sent",
  description: "Delete a record of money a band sent the label (label_funds lists them with their ids).",
  params: z.object({ id }),
  needs: { area: "funds", level: "edit" },
  action: (fd) => deleteBandRemittance(fd),
});

const bandPayout = actionTool({
  name: "mark_band_payout",
  label: "Mark a member paid by the band",
  description:
    "In a band's group whose sales Bandcamp pays to the band: mark one of a label's payout lines the band pays its member itself paid, or back to not paid (status pending).",
  params: z.object({ payoutLineId: id, status: z.enum(["paid", "pending"]), reference: z.string().max(120).optional() }),
  needs: "admin",
  available: (ctx) => ctx.org.kind === "band",
  action: (fd) => markBandPayout(fd),
  fields: (_ctx, a) => ({ id: a.payoutLineId, status: a.status, reference: a.reference }),
});

const paymentToLabel = actionTool({
  name: "record_payment_to_label",
  label: "Record money the band sent its label",
  description: "In a band's group whose sales Bandcamp pays to the band: record money it sent a label it's on (the label's share). linkId is the band's link to that label (group_links lists them).",
  params: z.object({ linkId: id, amount, currency: currency.optional(), date, note: z.string().max(500).optional() }),
  needs: "admin",
  available: (ctx) => ctx.org.kind === "band",
  action: (fd) => recordPaymentToLabel(null, fd),
});

export const MONEY_TOOLS = [
  payoutLineStatus,
  undoPayout,
  releaseUnpaid,
  saveSendOut,
  deleteSendOut,
  accountHolder,
  bandPaidTo,
  saveRemittance,
  deleteRemittance,
  bandPayout,
  paymentToLabel,
];
