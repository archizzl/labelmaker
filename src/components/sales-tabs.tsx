import { Tabs } from "./tabs";

type Tab = "browse" | "add" | "import";

/** All sales / Add a sale / Import, at the top of the Sales tab. */
export function SalesTabs({ active, unrouted = 0, canImport = true, canAdd = true }: { active: Tab; unrouted?: number; canImport?: boolean; canAdd?: boolean }) {
  return (
    <Tabs
      label="Sales"
      items={[
        { href: "/sales", label: "All sales", active: active === "browse" },
        ...(canAdd ? [{ href: "/sales/add", label: "Add a sale", active: active === "add" }] : []),
        ...(canImport
          ? [
              {
                href: "/sales/import",
                label: "Import",
                active: active === "import",
                badge: unrouted > 0 ? <span className="ml-1.5 rounded-full bg-bad-bg px-1.5 text-xs text-bad">{unrouted}</span> : undefined,
              },
            ]
          : []),
      ]}
    />
  );
}
