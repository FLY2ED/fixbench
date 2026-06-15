import { describe, it, expect } from "vitest";
import { maskPhone } from "./src/maskPhone";

// Target test — currently FAILS because the first digit of the middle group leaks.
describe("maskPhone", () => {
  it("masks the entire middle group", () => {
    expect(maskPhone("010-1234-5678")).toBe("010-****-5678");
  });

  it("masks a middle group of a different length", () => {
    expect(maskPhone("02-123-4567")).toBe("02-***-4567");
  });
});
