import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { newAccount, testDb } from "../../../test/helpers/db";
import { parseBandcampCsv } from "@/lib/bandcamp-csv";

let db: Awaited<ReturnType<typeof testDb>>["db"];
let schema: Awaited<ReturnType<typeof testDb>>["schema"];
let sync: typeof import("../sync");
let inventory: typeof import("../inventory");

beforeAll(async () => {
  ({ db, schema } = await testDb());
  sync = await import("../sync");
  inventory = await import("../inventory");
});

const report = (rows: string[]) => parseBandcampCsv(["date,item type,item name,artist,package,option,sku,quantity,currency,net amount,bandcamp transaction id", ...rows].join("\n"));

describe("merch sold on Bandcamp", () => {
  it("comes off its stock once, from when it's tracked, and goes back if the sales are deleted", async () => {
    const orgId = await newAccount();
    const [tee] = await db
      .insert(schema.inventoryItems)
      .values({ orgId, name: "Logo Tee", option: "M", sku: "TEE-M", onHand: 10, createdAt: "2026-05-01 09:00:00" })
      .returning();
    const rows = [
      "2026-04-20,package,Logo Tee,Glass Harbor,Logo Tee,M,TEE-M,1,USD,20.00,t1", // before it was counted
      "2026-05-02,package,Logo Tee,Glass Harbor,Logo Tee,M,TEE-M,2,USD,40.00,t2",
      "2026-05-03,package,Logo Tee,Glass Harbor,Logo Tee,M,TEE-M,1,USD,-20.00,t3", // a refund
      "2026-05-04,album,Night Swims,Glass Harbor,,,,1,USD,9.00,t4",
    ];
    await sync.saveSales(orgId, "report.csv", report(rows));
    const onHand = async () => (await db.select().from(schema.inventoryItems).where(eq(schema.inventoryItems.id, tee.id)))[0].onHand;
    expect(await onHand()).toBe(8);
    const [move] = await db.select().from(schema.inventoryMoves).where(eq(schema.inventoryMoves.itemId, tee.id));
    expect(move).toMatchObject({ reason: "sold", delta: -2, onHandAfter: 8, note: "From a Bandcamp sale on 2026-05-02" });

    // The next sync sees the same sales: nothing changes.
    await sync.saveSales(orgId, "sync", report([...rows, "2026-05-05,package,Logo Tee,Glass Harbor,Logo Tee,M,TEE-M,1,USD,20.00,t5"]));
    expect(await onHand()).toBe(7);

    const sold = await db.select({ id: schema.sales.id }).from(schema.sales).where(eq(schema.sales.orgId, orgId));
    await db.transaction((tx) => inventory.putBackStock(tx, sold.map((s) => s.id), null));
    expect(await onHand()).toBe(10);
  });
});
