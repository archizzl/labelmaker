/**
 * A page on this site to send someone to (a sign-in's `next`, "stop viewing"'s `back`, a link in
 * Abel's reply), or `fallback` if it isn't one. "//evil.com" and "/\evil.com" (which browsers read
 * as "//evil.com") lead to other sites, so only a path that stays on the same origin passes.
 */
export function safePath(path: string | null | undefined, fallback = "/"): string {
  if (!path || !path.startsWith("/") || /[\\\u0000-\u001f]/.test(path)) return fallback;
  try {
    const base = "https://same.invalid";
    return new URL(path, base).origin === base ? path : fallback;
  } catch {
    return fallback;
  }
}
