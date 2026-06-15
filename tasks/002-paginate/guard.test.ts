import { describe, it, expect } from "vitest";
import { paginate } from "./src/paginate";

// Regression guard — passes with the buggy code AND must STAY green after the fix.
// These cases don't depend on the dropped boundary item, so they catch an agent that
// "fixes" the off-by-one by breaking empty/out-of-range handling.
describe("paginate (guard)", () => {
  const items = [10, 20, 30, 40, 50, 60, 70];

  it("returns an empty array for a page past the end", () => {
    expect(paginate(items, 5, 3)).toEqual([]);
  });

  it("returns an empty array when there are no items", () => {
    expect(paginate([], 1, 3)).toEqual([]);
  });
});
