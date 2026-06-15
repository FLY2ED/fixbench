import { describe, it, expect } from "vitest";
import { parseDuration } from "./src/parseDuration";

// Regression guard — passes with the buggy code (no minutes involved) and must STAY green.
// Catches an agent that "fixes" minutes by breaking hours or seconds.
describe("parseDuration (guard)", () => {
  it("handles hours only", () => {
    expect(parseDuration("2h")).toBe(7200);
  });
  it("handles seconds only", () => {
    expect(parseDuration("90s")).toBe(90);
  });
});
