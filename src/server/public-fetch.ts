import "server-only";
import { isIp, isPrivateIp, publicAddressProblem } from "@/lib/public-address";

/*
 * Fetching a page from an address someone gave (a group's Bandcamp address, a release's link, a
 * photo on such a page). On the live site Cloudflare only lets the app reach the public internet
 * (global_fetch_strictly_public), but the catalog sync runs on the owner's Mac (npm run
 * sync-catalog), where an address like 192.168.1.1, or a site that redirects there, would reach
 * the home network. So the address, and each redirect after it, must be a public website.
 */

const MAX_REDIRECTS = 5;

const onWorkers = typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";

/** fetch, for a public website only. Throws a readable error for any other address. */
export async function fetchPublic(url: string, init: RequestInit = {}): Promise<Response> {
  let current = url;
  for (let hops = 0; ; hops++) {
    await checkPublic(current);
    const res = await fetch(current, { ...init, redirect: "manual" });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) return res;
    if (hops === MAX_REDIRECTS) throw new Error(`${url} redirects too many times.`);
    current = new URL(location, current).toString();
  }
}

async function checkPublic(url: string) {
  const problem = publicAddressProblem(url);
  if (problem) throw new Error(problem);
  // A public name can still point at a private address. (Cloudflare checks this itself.)
  const host = new URL(url).hostname;
  if (onWorkers || isIp(host)) return;
  let addresses: string[] = [];
  try {
    const { lookup } = await import("node:dns/promises");
    addresses = (await lookup(host, { all: true })).map((a) => a.address);
  } catch {
    // Not found: the fetch fails on its own.
  }
  if (addresses.some(isPrivateIp)) throw new Error(`${url} isn't a public website.`);
}
