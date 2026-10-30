/*
 * Who sends each part of a payout: the label, or a band whose sales Bandcamp pays to the band
 * itself (bands.paidTo), which pays its own members their part. Someone's payout is split by who
 * sends it, one line each.
 */

export type PayerPart = {
  /** The band that sends this part, or null for the label. */
  paidByBandId: number | null;
  total: number;
  byBand: Map<number, number>;
};

/** Split a person's payout (cents by band) by who sends it: the label first, then each band that pays its own. */
export function splitByPayer(byBand: Map<number, number>, bandPays: ReadonlySet<number>): PayerPart[] {
  const parts = new Map<number | null, PayerPart>();
  for (const [bandId, cents] of byBand) {
    const payer = bandPays.has(bandId) ? bandId : null;
    const part = parts.get(payer) ?? { paidByBandId: payer, total: 0, byBand: new Map() };
    part.total += cents;
    part.byBand.set(bandId, (part.byBand.get(bandId) ?? 0) + cents);
    parts.set(payer, part);
  }
  return [...parts.values()].sort((a, b) => (a.paidByBandId ?? 0) - (b.paidByBandId ?? 0));
}
