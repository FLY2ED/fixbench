import { describe, it, expect } from "vitest";
import { splitFee } from "./src/splitFee";

// Target test — currently FAILS because the remainder cents are dropped.
describe("splitFee", () => {
  it("distributes the remainder so parts sum back to the total", () => {
    expect(splitFee(100, 3)).toEqual([34, 33, 33]);
  });

  it("sums exactly to the total for an indivisible amount", () => {
    const parts = splitFee(101, 4);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(101);
    expect(parts).toEqual([26, 25, 25, 25]);
  });
});
