import { describe, it, expect } from "vitest";
import { splitFee } from "./src/splitFee";

// Regression guard — passes with the buggy code AND must STAY green after the fix.
// Uses an evenly divisible amount (no remainder), so it is unaffected by the bug but
// catches an agent that "fixes" the remainder by mangling the even-split or length.
describe("splitFee (guard)", () => {
  it("splits an evenly divisible amount into equal parts", () => {
    expect(splitFee(90, 3)).toEqual([30, 30, 30]);
  });

  it("returns exactly n parts", () => {
    expect(splitFee(50, 5)).toHaveLength(5);
  });
});
