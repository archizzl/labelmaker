import { asc, desc, eq, inArray } from "drizzle-orm";
import { BandFilter } from "@/components/band-filter";
import { connection } from "next/server";
import { ActionForm, SaveWhenChanged, SubmitButton } from "@/components/client";
import { DisclosureRow } from "@/components/disclosure-row";
import { Badge, Callout, Card, Disclosure, Empty, Field, PageHeader, Stat } from "@/components/ui";
import { db, schema } from "@/db";
import { isLow, MOVE_REASONS } from "@/lib/inventory";
import { InventoryCounter } from "@/components/inventory-counter";
import { formatCents } from "@/lib/money";
import { bandScope, can } from "@/lib/permissions";
import { requireAccess } from "@/server/context";
import { addFromCatalog, archiveInventoryItem, restoreInventoryItem, saveInventoryItem } from "@/server/inventory-actions";
import { merchPhotoUrl, ownPhotoId } from "@/server/merch-photos";
import { InventoryPhoto } from "@/components/inventory-photo";
import { formatDate } from "@/lib/dates";

/** A photo from Bandcamp (not one uploaded here): it can't be changed here. */
const fromBandcamp = (url: string | null | undefined) => !!url && ownPhotoId(url) === null;

export const metadata = { title: "inventory" };

type Item = typeof schema.inventoryItems.$inferSelect;
type Move = typeof schema.inventoryMoves.$inferSelect;
type Option = { id: number; name: string };
type CatalogOption = { value: string; label: string; bandId: number };

/** What the label (or band) has on hand: merch and formats it sells, and supplies it uses. */
export default async function InventoryPage({ searchParams }: PageProps<"/inventory">) {
  await connection();
  const { orgId, access } = await requireAccess("inventory");
  const scope = bandScope(access, "inventory");
  const canEdit = can(access, "inventory", "edit");
  const band = Number((await searchParams).band) || null;

  const [itemRows, bandRows, releaseRows] = await Promise.all([
    db
      .select()
      .from(schema.inventoryItems)
      .where(eq(schema.inventoryItems.orgId, orgId))
      .orderBy(asc(schema.inventoryItems.name), asc(schema.inventoryItems.option)),
    db.select({ id: schema.bands.id, name: schema.bands.name }).from(schema.bands).where(eq(schema.bands.orgId, orgId)).orderBy(asc(schema.bands.name)),
    db
      .select({ id: schema.releases.id, title: schema.releases.title, kind: schema.releases.kind, bandId: schema.releases.bandId, packages: schema.releases.packages, artUrl: schema.releases.artUrl })
      .from(schema.releases)
      .where(eq(schema.releases.orgId, orgId))
      .orderBy(asc(schema.releases.title)),
  ]);
  const inScope = (bandId: number | null) => !scope || (bandId !== null && scope.includes(bandId));
  const allItems = itemRows.filter((i) => !i.archived);
  const items = allItems.filter((i) => inScope(i.bandId) && (!band || i.bandId === band));
  // Taken off the list (their history is kept), to put back.
  const removed = itemRows.filter((i) => i.archived && inScope(i.bandId) && (!band || i.bandId === band));
  const bands = bandRows.filter((b) => inScope(b.id));
  const bandName = new Map(bandRows.map((b) => [b.id, b.name]));
  const moves = items.length
    ? await db
        .select()
        .from(schema.inventoryMoves)
        .where(inArray(schema.inventoryMoves.itemId, items.map((i) => i.id)))
        .orderBy(desc(schema.inventoryMoves.createdAt), desc(schema.inventoryMoves.id))
        .limit(1000)
    : [];
  const movesOf = (id: number) => moves.filter((m) => m.itemId === id).slice(0, 10);
  // Each item's photo: its catalog item's (a merch photo, or a release's cover for its formats), or
  // one uploaded for it.
  const art = new Map(releaseRows.filter((r) => r.artUrl).map((r) => [r.id, r.artUrl!]));
  const photoOf = (i: Item) => (i.releaseId ? (art.get(i.releaseId) ?? null) : i.photoId ? merchPhotoUrl(i.photoId) : null);
  // Catalog items to link to: each format of a release, and each merch item.
  const catalog: CatalogOption[] = releaseRows
    .filter((r) => inScope(r.bandId))
    .flatMap((r) =>
      r.packages.length
        ? r.packages.map((p) => ({ value: `${r.id}:${p.bandcampId}`, label: r.kind === "merch" ? p.title : `${r.title} — ${p.title}`, bandId: r.bandId }))
        : r.kind === "merch"
          ? [{ value: `${r.id}:`, label: r.title, bandId: r.bandId }]
          : [],
    );

  const products = items.filter((i) => i.kind === "product");
  const supplies = items.filter((i) => i.kind === "supply");
  const low = items.filter(isLow);
  const units = items.reduce((a, i) => a + i.onHand, 0);
  const value = new Map<string, number>();
  for (const i of items) if (i.unitCostCents) value.set(i.currency, (value.get(i.currency) ?? 0) + i.unitCostCents * i.onHand);
  const bandsWithItems = bands.filter((b) => allItems.some((i) => i.bandId === b.id));

  return (
    <>
      <PageHeader title="Inventory" />

      {bandsWithItems.length > 1 && <BandFilter path="/inventory" bands={bandsWithItems} current={band} all="everything" />}

      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Items" value={items.length} />
        <Stat label="Units on hand" value={units} />
        <Stat label="Running low" value={low.length} tone={low.length > 0 ? "warn" : undefined} />
        <Stat label="Value at cost" value={value.size ? [...value].map(([cur, c]) => formatCents(c, cur)).join(" · ") : "—"} />
      </div>

      {low.length > 0 && (
        <Callout>
          Running low: {low.map((i, n) => (
            <span key={i.id}>
              {n > 0 && ", "}
              <b>{itemLabel(i)}</b> ({i.onHand} left)
            </span>
          ))}
          .
        </Callout>
      )}

      {canEdit && (
        <div className="mb-8 flex flex-wrap items-start gap-3">
          <Disclosure summary="+ Add an item">
            <ItemForm bands={bands} catalog={catalog} defaultBand={band} ownBandsOnly={!!scope} />
          </Disclosure>
          <ActionForm action={addFromCatalog} className="flex flex-wrap items-center gap-2" keepOpen>
            {band && <input type="hidden" name="bandId" value={band} />}
            <SubmitButton variant="secondary" size="sm">
              Add from the catalog
            </SubmitButton>
          </ActionForm>
        </div>
      )}

      <Card title={`For sale (${products.length})`}>
        {products.length === 0 ? (
          <Empty>Nothing yet.</Empty>
        ) : (
          <ItemTable items={products} bandName={bandName} movesOf={movesOf} photoOf={photoOf} canEdit={canEdit} bands={bands} catalog={catalog} ownBandsOnly={!!scope} />
        )}
      </Card>

      <Card title={`Supplies (${supplies.length})`}>
        {supplies.length === 0 ? (
          <Empty>Nothing yet.</Empty>
        ) : (
          <ItemTable items={supplies} bandName={bandName} movesOf={movesOf} canEdit={canEdit} bands={bands} catalog={catalog} ownBandsOnly={!!scope} />
        )}
      </Card>

      {canEdit && removed.length > 0 && (
        <Disclosure summary={`Removed (${removed.length})`}>
          <ul className="divide-y divide-border text-sm">
            {removed.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 py-2">
                <span>
                  {itemLabel(i)}
                  {i.bandId && <span className="text-muted"> · {bandName.get(i.bandId)}</span>}
                </span>
                <form action={restoreInventoryItem}>
                  <input type="hidden" name="id" value={i.id} />
                  <SubmitButton variant="ghost" size="sm">
                    Put back
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </>
  );
}

const itemLabel = (i: Item) => `${i.name}${i.option ? ` (${i.option})` : ""}`;

function ItemTable({
  items,
  bandName,
  movesOf,
  photoOf,
  canEdit,
  bands,
  catalog,
  ownBandsOnly,
}: {
  items: Item[];
  bandName: Map<number, string>;
  movesOf: (id: number) => Move[];
  /** For sale only: a photo beside each item (a blank square when it has none, so the names line up). */
  photoOf?: (i: Item) => string | null;
  canEdit: boolean;
  bands: Option[];
  catalog: CatalogOption[];
  ownBandsOnly: boolean;
}) {
  return (
    <ul className="divide-y divide-border border-b border-border">
      {items.map((i) => {
        const photo = photoOf?.(i);
        return (
          <li key={i.id} className={`grid gap-3 py-3 ${photoOf ? "grid-cols-[3rem_minmax(0,1fr)] md:grid-cols-[3rem_minmax(0,1fr)_auto]" : "md:grid-cols-[minmax(0,1fr)_auto]"}`}>
            {/* A photo from Bandcamp stays; anything else can be given one here. */}
            {photoOf && <InventoryPhoto id={i.id} src={photo ?? null} editable={canEdit && !fromBandcamp(photo)} />}
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{i.name}</span>
                {i.option && <Badge>{i.option}</Badge>}
                {isLow(i) && <Badge tone="warn">running low</Badge>}
              </div>
              <div className="text-xs text-muted">
                {[i.bandId && bandName.get(i.bandId), i.sku && `SKU ${i.sku}`, i.location && `kept at ${i.location}`, i.priceCents !== null && `${formatCents(i.priceCents, i.currency)} each`, i.unitCostCents !== null && `costs ${formatCents(i.unitCostCents, i.currency)}`]
                  .filter(Boolean)
                  .join(" · ") || "—"}
              </div>
              {i.notes && <p className="text-xs text-muted">{i.notes}</p>}
              <DisclosureRow
                className="pt-1"
                panels={[
                  { label: "History", content: <History moves={movesOf(i.id)} /> },
                  ...(canEdit
                    ? [
                        {
                          label: "Edit",
                          content: (
                            <>
                              <ItemForm item={i} bands={bands} catalog={catalog} ownBandsOnly={ownBandsOnly} photo={photoOf?.(i) ?? null} />
                              <form action={archiveInventoryItem} className="mt-3">
                                <input type="hidden" name="id" value={i.id} />
                                <SubmitButton variant="ghost" size="sm" confirm={`Remove ${itemLabel(i)} from the inventory? Its history is kept.`}>
                                  Remove from inventory
                                </SubmitButton>
                              </form>
                            </>
                          ),
                        },
                      ]
                    : []),
                ]}
              />
            </div>
            <div className={photoOf ? "col-start-2 md:col-start-auto" : ""}>
              {canEdit ? (
                <InventoryCounter id={i.id} onHand={i.onHand} ideal={i.desired} low={isLow(i)} />
              ) : (
                <div className="text-2xl font-bold whitespace-nowrap tabular-nums md:text-right">
                  <span className={isLow(i) ? "text-warn" : i.onHand === 0 ? "text-muted" : ""}>{i.onHand}</span>
                  {i.desired !== null && <span className="text-muted"> / {i.desired}</span>}
                </div>
              )}
              {i.lowAt !== null && <div className="mt-1 text-xs text-muted md:text-right">low at {i.lowAt}</div>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// (In the history, without the note in brackets: "Sold". The counter's changes are "other" and a recount.)
const REASON_LABEL = new Map<string, string>(MOVE_REASONS.map((r) => [r.key, r.label.replace(/ \(.*\)$/, "")]));
const moveLabel = (m: Move) => (m.reason === "recount" ? "Count set" : m.reason === "other" ? (m.delta < 0 ? "Taken off" : "Added") : (REASON_LABEL.get(m.reason) ?? m.reason));

function History({ moves }: { moves: Move[] }) {
  if (!moves.length) return <p className="text-sm text-muted">No changes yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="data">
        <thead>
          <tr>
            <th>When</th>
            <th>What</th>
            <th className="num">Change</th>
            <th className="num">After</th>
          </tr>
        </thead>
        <tbody>
          {moves.map((m) => (
            <tr key={m.id}>
              <td className="text-xs text-muted">{formatDate(m.createdAt)}</td>
              <td>
                {moveLabel(m)}
                {m.note && <span className="text-muted"> · {m.note}</span>}
              </td>
              <td className={`num ${m.delta < 0 ? "text-bad" : m.delta > 0 ? "text-good" : ""}`}>{m.delta > 0 ? `+${m.delta}` : m.delta}</td>
              <td className="num">{m.onHandAfter}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ItemForm({
  item,
  bands,
  catalog,
  defaultBand,
  ownBandsOnly = false,
  photo = null,
}: {
  item?: Item;
  bands: Option[];
  catalog: CatalogOption[];
  defaultBand?: number | null;
  /** Limited to their own bands: no "label / shared" choice. */
  ownBandsOnly?: boolean;
  /** The photo it shows now. */
  photo?: string | null;
}) {
  const linked = item?.releaseId ? `${item.releaseId}:${item.packageId ?? ""}` : "";
  return (
    <ActionForm action={saveInventoryItem} className="grid gap-4 sm:grid-cols-3" keepOpen={!item}>
      {item && <input type="hidden" name="id" value={item.id} />}
      <Field label="Kind">
        <select name="kind" defaultValue={item?.kind ?? "product"}>
          <option value="product">For sale (merch, music)</option>
          <option value="supply">Supply (not for sale)</option>
        </select>
      </Field>
      <Field label="Name" className="sm:col-span-2">
        <input name="name" required defaultValue={item?.name} maxLength={200} />
      </Field>
      <Field label="Catalog item (optional)" className="sm:col-span-2">
        <select name="catalog" defaultValue={linked}>
          <option value="">Not in the catalog</option>
          {catalog.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </Field>
      {/* Only one band it can be (a band's own group): nothing to choose. */}
      {ownBandsOnly && bands.length === 1 ? (
        <input type="hidden" name="bandId" value={bands[0].id} />
      ) : (
        <Field label={ownBandsOnly ? "Band" : "Band (optional)"}>
          <select name="bandId" defaultValue={item?.bandId ?? defaultBand ?? (ownBandsOnly ? bands[0]?.id : "")}>
            {!ownBandsOnly && <option value="">The label / shared</option>}
            {bands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Size or option">
        <input name="option" defaultValue={item?.option ?? ""} maxLength={100} />
      </Field>
      <Field label="SKU">
        <input name="sku" defaultValue={item?.sku ?? ""} maxLength={100} />
      </Field>
      {!item ? (
        <Field label="On hand now">
          <input name="onHand" type="number" inputMode="numeric" min={0} step={1} defaultValue={0} />
        </Field>
      ) : (
        <div />
      )}
      <Field label="Running low at">
        <input name="lowAt" type="number" inputMode="numeric" min={0} step={1} defaultValue={item?.lowAt ?? ""} />
      </Field>
      {!item && (
        <Field label="Ideal count (optional)">
          <input name="desired" type="number" inputMode="numeric" min={1} step={1} />
        </Field>
      )}
      <Field label="Price each (optional)">
        <input name="price" inputMode="decimal" defaultValue={item?.priceCents != null ? (item.priceCents / 100).toFixed(2) : ""} placeholder="3.00" />
      </Field>
      <Field label="Cost each (optional)">
        <input name="unitCost" inputMode="decimal" defaultValue={item?.unitCostCents != null ? (item.unitCostCents / 100).toFixed(2) : ""} placeholder="0.85" />
      </Field>
      <Field label="Kept at">
        <input name="location" defaultValue={item?.location ?? ""} maxLength={200} />
      </Field>
      <Field label="Notes" className="sm:col-span-3">
        <input name="notes" defaultValue={item?.notes ?? ""} maxLength={1000} />
      </Field>
      {fromBandcamp(photo) ? (
        <div className="sm:col-span-3" />
      ) : (
        <>
          <Field label="Photo" className="sm:col-span-2">
            <input type="file" name="photo" accept="image/jpeg,image/png,image/gif,image/webp" className="text-xs" />
          </Field>
          {photo ? (
            <label className="flex items-center gap-1.5 self-end pb-2 text-sm">
              <input type="checkbox" name="removePhoto" value="1" /> Remove its photo
            </label>
          ) : (
            <div />
          )}
        </>
      )}
      <div className="sm:col-span-3">
        {item ? (
          <SaveWhenChanged>
            <SubmitButton>Save</SubmitButton>
          </SaveWhenChanged>
        ) : (
          <SubmitButton>Add item</SubmitButton>
        )}
      </div>
    </ActionForm>
  );
}
