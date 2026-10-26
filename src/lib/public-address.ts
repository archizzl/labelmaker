/*
 * Whether an address is a public website: not this computer, not a home or office network, not a
 * cloud's internal one. src/server/public-fetch.ts checks every page the app fetches for someone.
 */

/** Names that only mean something inside a network. */
const LOCAL_NAMES = /(^|\.)(localhost|local|internal|intranet|lan|home|home\.arpa|corp|private)$/;

/** What's wrong with fetching this address, or null if it's a public website. */
export function publicAddressProblem(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return `${url} isn't a web address.`;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return `${url} isn't a web address.`;
  if (u.port && u.port !== "80" && u.port !== "443") return `${url} isn't a public website.`;
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIp(host) ? isPrivateIp(host) : !host.includes(".") || LOCAL_NAMES.test(host)) return `${url} isn't a public website.`;
  return null;
}

export function isIp(host: string) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

/** An address on a private, local or reserved network (IPv4 or IPv6), or one that isn't an address. */
export function isPrivateIp(ip: string): boolean {
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && Number(v4[3]) === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (!ip.includes(":")) return true;
  const v6 = ip.toLowerCase();
  // ::, ::1 and IPv4 inside IPv6 (::ffff:10.0.0.1), unique-local, link-local, multicast, NAT64.
  return v6.startsWith("::") || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || v6.startsWith("ff") || v6.startsWith("64:ff9b:");
}
