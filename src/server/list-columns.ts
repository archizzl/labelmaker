import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { cleanHidden, type ListId } from "@/lib/list-columns";
import { accountContext } from "./context";

/** The columns this person hides in a list of sales, in the group they're in as itself (none saved: none). */
export async function loadHiddenColumns(list: ListId): Promise<string[]> {
  const { user, orgId } = await accountContext();
  const [row] = await db
    .select({ hidden: schema.listColumns.hidden })
    .from(schema.listColumns)
    .where(and(eq(schema.listColumns.userId, user.id), eq(schema.listColumns.orgId, orgId), eq(schema.listColumns.listId, list)));
  return cleanHidden(list, row?.hidden);
}
