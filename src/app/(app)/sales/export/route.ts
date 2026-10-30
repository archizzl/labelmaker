import Papa from "papaparse";
import type { NextRequest } from "next/server";
import { centsToDecimal } from "@/lib/money";
import { bandScope } from "@/lib/permissions";
import { requireAccess } from "@/server/context";
import { allMatchingSales, parseSalesFilter, salesBooksFor } from "@/server/sales-browse";

/** The Sales tab's filtered sales as a CSV: the main columns, then everything Bandcamp reported. */
export async function GET(req: NextRequest) {
  const { orgId, org, access } = await requireAccess("sales");
  // A band's group on a label: its own sales and each label's for it, as on the Sales tab.
  const books = org.kind === "band" ? await salesBooksFor(org.id) : orgId;
  const onLabel = typeof books !== "string";
  const f = { ...parseSalesFilter(Object.fromEntries(req.nextUrl.searchParams)), onlyBands: onLabel ? undefined : (bandScope(access, "sales") ?? undefined), ...(onLabel ? { band: undefined } : {}) };
  const rows = await allMatchingSales(books, f);
  const rawKeys = [...new Set(rows.flatMap((r) => Object.keys(r.sale.raw)))];
  const csv = Papa.unparse({
    fields: ["date", "band", "release", "item", "type", "format", "quantity", "currency", "net", "transaction id", ...rawKeys.map((k) => `bandcamp: ${k}`)],
    data: rows.map(({ sale: s, bandName, releaseTitle }) => [
      s.date,
      bandName ?? "",
      releaseTitle ?? "",
      s.itemName,
      s.category,
      s.packageName,
      s.quantity,
      s.currency,
      centsToDecimal(s.netCents),
      s.transactionId,
      ...rawKeys.map((k) => s.raw[k] ?? ""),
    ]),
  });
  const slug = org.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "sales";
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}-sales.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
