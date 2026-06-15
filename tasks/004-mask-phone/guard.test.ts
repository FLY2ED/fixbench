import { describe, it, expect } from "vitest";
import { maskPhone } from "./src/maskPhone";

// Regression guard — passes with the buggy code AND must STAY green after the fix.
// Asserts the first/last groups and dashes are preserved (unaffected by the middle bug),
// so it catches an agent that "fixes" the leak by over-masking other groups.
describe("maskPhone (guard)", () => {
  it("keeps the first and last groups and dashes intact", () => {
    const out = maskPhone("010-1234-5678");
    expect(out.startsWith("010-")).toBe(true);
    expect(out.endsWith("-5678")).toBe(true);
    expect(out.split("-")).toHaveLength(3);
  });

  it("leaves a non-conforming input unchanged", () => {
    expect(maskPhone("not-a-phone-number")).toBe("not-a-phone-number");
  });
});
