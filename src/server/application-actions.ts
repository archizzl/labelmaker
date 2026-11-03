"use server";

import { revalidatePath } from "next/cache";
import { approveApplication, rejectApplication } from "./applications";
import type { ActionState } from "./actions";
import { asFormResult } from "./form-result";
import { requireSiteAdmin } from "./site-admin";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");

/** Site admin: approve an application, setting the account up. */
export async function approveAccountApplication(fd: FormData) {
  const session = await requireSiteAdmin();
  await approveApplication(Number(str(fd, "id")), session.user.id);
  revalidatePath("/admin");
}
export async function approveAccountApplicationForm(_: ActionState, fd: FormData): Promise<ActionState> {
  return asFormResult(() => approveAccountApplication(fd));
}

/** Site admin: turn an application down, with a note the applicant sees. */
export async function rejectAccountApplication(fd: FormData) {
  const session = await requireSiteAdmin();
  await rejectApplication(Number(str(fd, "id")), session.user.id, str(fd, "note").trim().slice(0, 1000) || null);
  revalidatePath("/admin");
}
export async function rejectAccountApplicationForm(_: ActionState, fd: FormData): Promise<ActionState> {
  return asFormResult(() => rejectAccountApplication(fd));
}
