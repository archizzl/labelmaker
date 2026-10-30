"use server";

import { db, schema } from "@/db";
import { cleanHidden, isListId } from "@/lib/list-columns";
import { accountContext } from "./context";

/*
 * Saving which columns a person hides in a list of sales. Anyone signed in chooses their own, in the
 * group they're in as itself (as with chart layouts), never anyone else's.
 */

export async function saveHiddenColumns(list: string, hidden: string[]) {
  const { user, orgId } = await accountContext();
  if (!isListId(list)) return;
  const clean = cleanHidden(list, hidden);
  await db
    .insert(schema.listColumns)
    .values({ userId: user.id, orgId, listId: list, hidden: clean })
    .onConflictDoUpdate({
      target: [schema.listColumns.userId, schema.listColumns.orgId, schema.listColumns.listId],
      set: { hidden: clean, updatedAt: new Date().toISOString().replace("T", " ").slice(0, 19) },
    });
}
