/*
 * Applications for a new label or band group, from before anyone could set one up: the plain logic
 * the admin dashboard's approving still uses.
 */

/** "flagday" from https://flagday.bandcamp.com/…, for matching sales to a band. */
export function bandcampSubdomain(url: string | null): string | null {
  const m = url?.match(/^https?:\/\/([a-z0-9-]+)\.bandcamp\.com/i);
  return m ? m[1].toLowerCase() : null;
}
