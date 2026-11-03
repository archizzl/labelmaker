import { Tabs } from "./tabs";

type Tab = "funds" | "rules";

/** Label funds / Rules, at the top of the Funds tab (only the ones they can see; no bar for just one). */
export function FundsTabs({ active, funds, rules }: { active: Tab; funds: boolean; rules: boolean }) {
  if (!funds || !rules) return null;
  return (
    <Tabs
      label="Funds"
      items={[
        { href: "/funds", label: "Label funds", active: active === "funds" },
        { href: "/rules", label: "Rules", active: active === "rules" },
      ]}
    />
  );
}
