import "server-only";
import { isRedirectError } from "next/dist/client/components/redirect-error";

/**
 * Run an action that throws its errors, for a form that shows them beside it (ActionForm): on the
 * live site a thrown error reaches the error page without its message. Redirects still happen.
 */
export async function asFormResult(run: () => Promise<unknown>, ok?: string): Promise<{ ok?: string; error?: string }> {
  try {
    await run();
    return ok ? { ok } : {};
  } catch (e) {
    if (isRedirectError(e)) throw e;
    return { error: (e as Error).message };
  }
}
