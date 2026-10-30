import { describe, expect, it } from "vitest";
import { splitByPayer } from "../payers";

describe("splitting a payout by who sends it", () => {
  it("keeps what the label sends together, and gives each band that pays its own a part", () => {
    const parts = splitByPayer(
      new Map([
        [1, 500],
        [2, 300],
        [3, 200],
      ]),
      new Set([2, 3]),
    );
    expect(parts.map((p) => ({ by: p.paidByBandId, total: p.total, bands: [...p.byBand.keys()] }))).toEqual([
      { by: null, total: 500, bands: [1] },
      { by: 2, total: 300, bands: [2] },
      { by: 3, total: 200, bands: [3] },
    ]);
  });

  it("is one part when the label pays everything", () => {
    expect(splitByPayer(new Map([[1, 500]]), new Set())).toMatchObject([{ paidByBandId: null, total: 500 }]);
  });
});
