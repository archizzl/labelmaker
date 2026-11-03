import { cookies } from "next/headers";
import { accountsFor, getSession, siteViewAsValue, VIEW_AS_COOKIE } from "@/server/context";
import { isSiteAdminEmail } from "@/server/site-admin";

/**
 * A site admin's "view as" (the admin dashboard's Accounts and Groups): see the app as one login, in
 * one of its groups. On the live site the dashboard has its own address (admin.labelmaker.ing), so
 * its button posts here, on the app's address, where the cookie has to be and the app opens.
 * Read-only, for a few hours, and checked again on every request (src/server/context.ts).
 */
export async function POST(request: Request) {
  // Only from this site's own pages (the app, or its admin dashboard's address).
  const allowed = [process.env.BETTER_AUTH_URL, process.env.ADMIN_URL].filter(Boolean).map((u) => new URL(u!).origin);
  const origin = request.headers.get("origin");
  if (!origin || !(allowed.includes(origin) || origin === new URL(request.url).origin)) return new Response("Not allowed", { status: 403 });
  const session = await getSession();
  if (!session || !isSiteAdminEmail(session.user.email)) return new Response("Not found", { status: 404 });
  const fd = await request.formData();
  const userId = String(fd.get("userId") ?? "");
  const orgId = String(fd.get("orgId") ?? "");
  if (!(await accountsFor(userId)).some((a) => a.id === orgId)) return new Response("That login isn't in that group.", { status: 400 });
  (await cookies()).set(VIEW_AS_COOKIE, siteViewAsValue(userId, orgId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 4 * 60 * 60,
  });
  return new Response(null, { status: 303, headers: { location: "/", "cache-control": "no-store" } });
}
