"use server";

import { and, eq, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireAdmin } from "./context";
import { asFormResult } from "./form-result";
import type { ActionState } from "./actions";

const { accountLinks } = schema;

/** Either side can end a link (or the label can cancel a code that hasn't been used). */
export async function unlink(fd: FormData) {
  const ctx = await requireAdmin();
  await db
    .delete(accountLinks)
    .where(
      and(
        eq(accountLinks.id, Number(fd.get("id"))),
        or(eq(accountLinks.labelOrgId, ctx.orgId), eq(accountLinks.bandOrgId, ctx.orgId)),
        // A sub-account the label made stays linked: it goes when the band does.
        eq(accountLinks.managed, false),
      ),
    );
  revalidatePath("/", "layout");
}

/** unlink for its form: errors shown beside it. */
export async function unlinkForm(_: ActionState, fd: FormData): Promise<ActionState> {
  return asFormResult(() => unlink(fd));
}
