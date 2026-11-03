import { Tabs } from "./tabs";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "money", label: "Money" },
  { key: "people", label: "People" },
  { key: "catalog", label: "Catalog" },
  { key: "settings", label: "Settings" },
] as const;

export type BandTab = (typeof TABS)[number]["key"];

/** The parts of a band's page: how it's doing, its money rules, its people, its releases, its settings. */
export function BandTabs({
  bandId,
  active,
  needsSplit,
  members,
  noSettings = false,
}: {
  bandId: number;
  active: BandTab;
  needsSplit: boolean;
  members: number;
  /** Its settings are somewhere else (a label-made band account's own books: Settings). */
  noSettings?: boolean;
}) {
  return (
    <Tabs
      label="Band"
      className="mb-8"
      items={TABS.filter((t) => !(noSettings && t.key === "settings")).map((t) => ({
        href: t.key === "overview" ? `/bands/${bandId}` : `/bands/${bandId}?tab=${t.key}`,
        label: t.label,
        active: active === t.key,
        badge:
          t.key === "money" && needsSplit ? (
            <span className="ml-1.5 rounded-full bg-bad-bg px-1.5 text-xs text-bad" aria-label="No split yet">
              !
            </span>
          ) : t.key === "people" ? (
            members
          ) : undefined,
      }))}
    />
  );
}
