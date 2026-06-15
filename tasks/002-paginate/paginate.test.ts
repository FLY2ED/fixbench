import { describe, it, expect } from "vitest";
import { paginate } from "./src/paginate";

// Target test — currently FAILS because each page drops its last item (off-by-one on the end bound).
describe("paginate", () => {
  const items = [10, 20, 30, 40, 50, 60, 70];

  it("returns a full first page of pageSize items", () => {
    expect(paginate(items, 1, 3)).toEqual([10, 20, 30]);
  });

  it("returns the correct middle page without overlap or gaps", () => {
    expect(paginate(items, 2, 3)).toEqual([40, 50, 60]);
  });

  it("returns the remainder on the last page", () => {
    expect(paginate(items, 3, 3)).toEqual([70]);
  });
});
