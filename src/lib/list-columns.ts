/*
 * The columns of each list of sales that a person can show or hide (Columns, next to the list's
 * filters). The item's own column always shows. Cells carry data-col with their column's key, and the
 * list's wrapper data-cols with its id; hidden ones are hidden by a style rule (ColumnsMenu).
 */

export type ListColumn = { key: string; label: string };

export const LIST_COLUMNS = {
  /** The Sales page. */
  sales: [
    { key: "date", label: "Date" },
    { key: "band", label: "Band" },
    { key: "type", label: "Type" },
    { key: "country", label: "Country" },
    { key: "source", label: "From" },
    { key: "qty", label: "Qty" },
    { key: "net", label: "Net" },
    { key: "paidTo", label: "Paid to" },
    { key: "payout", label: "Paid out" },
  ],
  /** "By release and item", under a band's, a release's or a member's sales. */
  items: [
    { key: "sold", label: "Sold" },
    { key: "digital", label: "Digital" },
    { key: "physical", label: "Physical / merch" },
    { key: "paid", label: "Fans paid" },
    { key: "fees", label: "Fees, tax & shipping" },
    { key: "net", label: "Net" },
    { key: "people", label: "To people" },
  ],
  /** Funds: where the label's money came from, sale by sale. */
  "label-income": [
    { key: "date", label: "Date" },
    { key: "toLabel", label: "To the label" },
    { key: "source", label: "Source" },
    { key: "band", label: "Band" },
    { key: "amount", label: "Sale amount" },
  ],
  /** A payout's every sale, and how each was split. */
  "payout-sales": [
    { key: "date", label: "Date" },
    { key: "band", label: "Band" },
    { key: "net", label: "Net" },
    { key: "deductions", label: "Deductions" },
    { key: "split", label: "Split" },
  ],
} satisfies Record<string, ListColumn[]>;

export type ListId = keyof typeof LIST_COLUMNS;

export const isListId = (id: unknown): id is ListId => typeof id === "string" && Object.hasOwn(LIST_COLUMNS, id);

/** Only keys that are this list's columns. */
export const cleanHidden = (list: ListId, hidden: unknown): string[] =>
  Array.isArray(hidden) ? [...new Set(hidden.filter((k): k is string => typeof k === "string" && LIST_COLUMNS[list].some((c) => c.key === k)))] : [];
