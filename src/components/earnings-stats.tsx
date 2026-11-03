import { Money, MoneyList, Stat } from "@/components/ui";
import { addTotals } from "@/server/earnings";

type Totals = Map<string, number>;

/**
 * Someone's earnings in three figures: what they've earned since their last payout (in a payout
 * not paid yet, or in none yet), what they've been paid, and both together.
 */
export function EarningsStats({ owed, received, upcoming }: { owed: Totals; received: Totals; upcoming: Totals }) {
  const since = addTotals(owed, upcoming);
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Stat label="Earned since last payout" value={<Amount totals={since} />} tone="accent" />
      <Stat label="Paid so far" value={<Amount totals={received} />} />
      <Stat label="Earned total" value={<Amount totals={addTotals(since, received)} />} />
    </div>
  );
}

function Amount({ totals }: { totals: Totals }) {
  return totals.size ? <MoneyList totals={totals} /> : <Money cents={0} />;
}
