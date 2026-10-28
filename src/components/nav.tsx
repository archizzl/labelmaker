"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Area } from "@/lib/permissions";
import { signOut, switchAccount } from "@/server/account-actions";
import type { Account } from "@/server/context";
import { AbelButton } from "./abel/abel-panel";
import { Avatar } from "./avatar";
import { SyncIndicator } from "./sync-indicator";

/** Our mark: a hand-drawn label with a smiley and a note, in the text colour. */
export function Logo({ className = "h-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 579 240" className={`w-auto shrink-0 ${className}`} fill="currentColor" aria-hidden>
      <path
        transform="translate(0 240) scale(1 -1)"
        d="M265 229 l-260 -6 -1 -109 0 -109 15 0 c8 0 136 3 285 7 l271 8 -1 5 c0 2 -1 50 -3 105 -2 55 -3 102 -4 103 l0 2 -21 0 c-12 0 -138 -3 -281 -6z m298 -3 c0 -2 1 -48 3 -102 2 -55 3 -99 3 -99 0 -1 -545 -15 -554 -15 l-5 0 0 104 0 104 15 0 c8 0 123 3 256 6 133 3 251 6 262 6 l20 0 0 -4z M398 202 c-5 -1 -18 -3 -27 -5 -10 -2 -25 -6 -33 -8 -19 -7 -18 -6 -18 -31 0 -20 1 -28 8 -50 2 -7 4 -13 4 -13 0 0 -2 0 -4 1 -11 1 -18 -9 -15 -21 3 -10 24 -25 36 -25 7 0 11 3 12 11 0 4 -1 8 -8 28 -10 24 -19 53 -17 53 0 0 6 2 13 4 8 2 23 6 36 9 l22 5 0 -3 c1 -1 3 -11 5 -22 1 -11 3 -20 4 -21 0 -2 -1 -2 -6 -1 -11 1 -19 -4 -21 -13 -5 -20 20 -46 32 -34 9 9 9 19 2 82 -1 10 -2 25 -3 34 -2 24 -2 24 -22 20z M173 186 c-24 -4 -46 -24 -55 -48 -4 -12 -4 -36 0 -47 9 -25 31 -44 55 -49 46 -8 86 23 88 68 1 23 -6 41 -22 56 -9 9 -15 13 -28 18 -6 2 -30 4 -38 2z m40 -8 c54 -24 57 -99 4 -124 -38 -19 -86 3 -95 44 -8 34 9 67 41 80 8 3 12 4 28 4 13 -1 14 -1 22 -4z M202 149 c-6 -7 -2 -17 7 -17 10 0 14 14 5 19 -5 2 -8 1 -12 -2z M156 145 c-9 -5 -5 -19 6 -19 3 0 9 6 9 9 0 8 -8 13 -15 10z M213 93 c-9 -8 -21 -12 -36 -12 -11 0 -13 -1 -13 -4 0 -3 4 -4 16 -4 15 1 33 8 40 15 4 6 -1 9 -7 5z"
      />
    </svg>
  );
}

/** The mark and the name, as the header shows them. */
export function Wordmark() {
  return (
    <span className="flex items-center gap-2.5 text-text">
      <Logo />
      <span className="text-[22px] leading-none font-bold tracking-[-0.03em] lowercase">labelmaker</span>
    </span>
  );
}

type Item = { href: string; label: string };

function itemsFor(
  account: Account,
  isAdmin: boolean,
  areas: Area[],
  labels: Item[],
  projects: boolean,
  managed: string | null,
  bandHref: string | null,
  hideOrders: boolean,
  earnings: boolean,
): Item[] {
  // A band account the label made: its own books with the label's part for it (dashboard, sales,
  // payouts, receipts, splits), its part of the label's (orders, inventory, funds, catalog,
  // Directory), and its settings.
  if (managed) {
    return [
      isAdmin ? { href: "/", label: "dashboard" } : { href: "/me", label: "my earnings" },
      { href: "/sales", label: "sales" },
      ...(hideOrders ? [] : [{ href: "/orders", label: "orders" }]),
      { href: "/inventory", label: "inventory" },
      { href: "/periods", label: "payouts" },
      { href: "/funds", label: "funds" },
      { href: "/receipts", label: "receipts" },
      ...(isAdmin && bandHref ? [{ href: `${bandHref}?tab=money`, label: "splits" }] : []),
      { href: "/catalog", label: "catalog" },
      { href: "/directory", label: "directory" },
      // The band's own login runs it (who signs in, its password); everyone else has their own account.
      ...(isAdmin ? [{ href: "/settings", label: "settings" }] : []),
    ];
  }
  const all: (Item & { area?: Area })[] = [
    { href: "/", label: "dashboard", area: "dashboard" },
    { href: "/sales", label: "sales", area: "sales" },
    ...(hideOrders ? [] : [{ href: "/orders", label: "orders", area: "orders" as const }]),
    { href: "/inventory", label: "inventory", area: "inventory" },
    { href: "/periods", label: "payouts", area: "payouts" },
    ...(account.kind === "label" ? [{ href: "/funds", label: "funds", area: "funds" as const }] : []),
    { href: "/receipts", label: "receipts", area: "receipts" },
    // A band account: its splits (the money part of its band's page; everything else there is in
    // the other tabs). A label's are under Rules.
    ...(account.kind === "band" && bandHref ? [{ href: `${bandHref}?tab=money`, label: "splits", area: "rules" as const }] : []),
    { href: "/directory", label: "directory", area: "roster" },
    // { href: "/fans", label: "fans", area: "fans" },
    { href: "/catalog", label: "catalog", area: "catalog" },
  ];
  if (isAdmin)
    return [
      ...all,
      ...(projects ? [{ href: "/projects", label: "projects" }] : []),
      ...labels,
      ...(earnings ? [{ href: "/me", label: "my earnings" }] : []),
      { href: "/settings", label: "settings" },
    ];
  // Members: their own earnings, plus whatever their member type lets them see. Funds has Rules as
  // a tab: someone who sees only the rules gets Funds opening on them.
  const funds = account.kind === "label" && (areas.includes("funds") || areas.includes("rules"));
  return [
    { href: "/me", label: "my earnings" },
    ...all
      .filter((i) => i.area && (areas.includes(i.area) || (i.area === "funds" && funds)))
      .map((i) => (i.area === "funds" && !areas.includes("funds") ? { ...i, href: "/rules" } : i)),
  ];
}

/** Pick which of your accounts (labels and bands) you're working in. */
function AccountSwitcher({ account, accounts, photos }: { account: Account; accounts: Account[]; photos: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // Closes on a click anywhere else, or Escape.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const current = (
    <>
      <Avatar name={account.name} src={photos[account.id]} size={26} square />
      <span className="hidden max-w-48 truncate sm:inline">{account.name}</span>
    </>
  );
  if (accounts.length < 2) return <span className="flex items-center gap-2 text-sm text-muted">{current}</span>;
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${account.name}: switch group`}
        className={`flex items-center gap-2 rounded-sm py-0.5 pr-1.5 pl-0.5 text-sm hover:bg-surface-2 hover:text-text ${open ? "bg-surface-2 text-text" : "text-muted"}`}
      >
        {current}
        <span aria-hidden className={`text-[10px] transition ${open ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>
      {open && (
        <form action={switchAccount} className="absolute right-0 z-20 mt-1 max-h-[70vh] w-64 overflow-y-auto border border-border bg-surface py-1 shadow-lg" role="menu">
          {accounts.map((a) => (
            <button
              key={a.id}
              type="submit"
              name="orgId"
              value={a.id}
              role="menuitem"
              disabled={a.id === account.id}
              className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-surface-2 ${a.id === account.id ? "font-bold text-text" : "text-muted hover:text-text"}`}
            >
              <Avatar name={a.name} src={photos[a.id]} size={28} square />
              <span className="min-w-0 flex-1 truncate">{a.name}</span>
              {a.id === account.id && <span aria-hidden>✓</span>}
            </button>
          ))}
        </form>
      )}
    </div>
  );
}

export function Nav({
  user,
  account,
  accounts,
  groupPhotos = {},
  isAdmin,
  areas = [],
  badges = {},
  labels = [],
  syncing = false,
  syncedAt = null,
  catalogBusy = false,
  siteAdmin = false,
  projects = false,
  showAdminLink = true,
  managed = null,
  viewing = false,
  bandHref = null,
  hideOrders = false,
  bandLogin = false,
  earnings = false,
  abel = false,
}: {
  user: { name: string; email: string; image?: string | null };
  account: Account;
  accounts: Account[];
  /** Each group's photo (its Bandcamp profile photo), by id. */
  groupPhotos?: Record<string, string>;
  isAdmin: boolean;
  /** For members: the sections their member type lets them see. */
  areas?: Area[];
  /** Numbers on tabs: orders to ship, new sales, receipts to approve. */
  badges?: Partial<Record<"orders" | "sales" | "receipts", number>>;
  /** Band accounts: a link to each label they're linked to. */
  labels?: Item[];
  /** A background sync with Bandcamp is running (or about to). */
  syncing?: boolean;
  /** When the last sync with Bandcamp finished (so the page can tell when another one has). */
  syncedAt?: string | null;
  /** A catalog sync (on the Mac) is waiting or running for the books shown. */
  catalogBusy?: boolean;
  /** Runs the whole site: gets the Admin link. */
  siteAdmin?: boolean;
  /** Projects is switched on for them (a flagged feature). */
  projects?: boolean;
  /** Link to the admin dashboard (site admins; not on the live site, where it has its own address). */
  showAdminLink?: boolean;
  /** A band account a label made for one of its bands: its home page. */
  managed?: string | null;
  /** A label admin viewing as someone else: no switching accounts or signing out from here. */
  viewing?: boolean;
  /** Signed in as a band (its shared login), not a person: no Account page. */
  bandLogin?: boolean;
  /** A band account's own band page. */
  bandHref?: string | null;
  /** No Bandcamp API access or pickups yet: the Orders tab would only say how to connect. */
  hideOrders?: boolean;
  /** An admin who's also paid in these books: their own earnings page. */
  earnings?: boolean;
  /** Abel, the assistant, is on for them: his button. */
  abel?: boolean;
}) {
  const path = usePathname();
  // "New sales" counts from your last look at Sales: once you've opened it, stop showing the number
  // (the header isn't reloaded on every click, so it would otherwise linger).
  const [seenSales, setSeenSales] = useState(false);
  if (path === "/sales" && !seenSales) setSeenSales(true);
  const countFor = (href: string) => {
    const key = href.slice(1) as "orders" | "sales" | "receipts";
    if (key === "sales" && seenSales) return 0;
    return badges[key] ?? 0;
  };
  const items = [...itemsFor(account, isAdmin, areas, labels, projects, managed, bandHref, hideOrders, earnings), ...(siteAdmin && showAdminLink && !viewing ? [{ href: "/admin", label: "admin" }] : [])];
  return (
    <header className="no-print border-b border-border bg-surface">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 pt-4 pb-3 md:px-8">
        <Link href="/" className="hover:no-underline">
          <Wordmark />
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <SyncIndicator active={syncing} syncedAt={syncedAt} catalogBusy={catalogBusy} />
          {/* You, with your photo: your Account page. (A band's shared login is the band: no page, no photo.) */}
          {bandLogin || viewing ? (
            (!managed || user.name !== account.name) && <span className="hidden text-sm text-muted sm:inline">{user.name}</span>
          ) : (
            <Link
              href="/account"
              className={`flex items-center gap-2 text-sm hover:no-underline ${path.startsWith("/account") ? "text-text" : "text-muted hover:text-text"}`}
            >
              <Avatar name={user.name} src={user.image} size={26} />
              <span className="hidden sm:inline">{user.name}</span>
            </Link>
          )}
          {/* The group you're in (a label or band), and switching to another. */}
          <AccountSwitcher account={account} accounts={accounts} photos={groupPhotos} />
          {abel && <AbelButton />}
          {!viewing && (
            <form action={signOut}>
              <button type="submit" className="text-sm text-link hover:underline">
                sign out
              </button>
            </form>
          )}
        </div>
      </div>
      <nav className="mx-auto max-w-5xl px-4 md:px-8">
        <ul className="-mb-px flex gap-x-5 overflow-x-auto md:flex-wrap md:overflow-visible">
          {items.map((it) => {
            // A band's own page sits under the directory (unless the nav has a tab for that band).
            const base = (href: string) => href.split("?")[0];
            const active =
              it.href === "/"
                ? path === "/"
                : path.startsWith(base(it.href)) ||
                  // Rules is a tab of Funds.
                  (it.label === "funds" && path.startsWith("/rules")) ||
                  (it.href === "/directory" && path.startsWith("/bands/") && !items.some((x) => path.startsWith(base(x.href)) && x.href.startsWith("/bands/")));
            const n = countFor(it.href);
            const what = { "/orders": "to ship or hand over", "/sales": "new", "/receipts": "to approve" }[it.href] ?? "";
            return (
              <li key={it.href}>
                <Link
                  href={it.href}
                  className={`flex items-center gap-1.5 border-b-2 pt-1 pb-2 whitespace-nowrap hover:no-underline ${
                    active ? "border-text text-text" : "border-transparent text-muted hover:text-text"
                  }`}
                >
                  {it.label}
                  {n > 0 && (
                    <span
                      className="min-w-[1.15rem] rounded-full bg-accent px-1.5 text-center text-[11px] leading-[1.15rem] font-bold text-accent-fg tabular-nums"
                      aria-label={`${n} ${what}`}
                    >
                      {n > 99 ? "99+" : n}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
