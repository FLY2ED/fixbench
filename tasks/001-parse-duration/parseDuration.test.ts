import { describe, it, expect } from "vitest";
import { parseDuration } from "./src/parseDuration";

// Target test — currently FAILS because of the minutes bug.
describe("parseDuration", () => {
  it("handles hours and minutes", () => {
    expect(parseDuration("1h30m")).toBe(5400);
  });
  it("handles minutes only", () => {
    expect(parseDuration("45m")).toBe(2700);
  });
});
