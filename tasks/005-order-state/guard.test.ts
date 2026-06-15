import { describe, it, expect } from "vitest";
import { OrderMachine } from "./src/machine";

// Regression guard — passes with the buggy code AND must STAY green after the fix.
// Exercises cross-file behavior (machine.ts driving transitions.ts) that the missing
// `paid -> cancel` edge does not affect, catching an agent that "fixes" cancellation by
// loosening other transitions or breaking the happy path / illegal-event handling.
describe("OrderMachine (guard)", () => {
  it("walks the full happy path to delivered", () => {
    const m = new OrderMachine();
    const result = m.run(["place", "pay", "ship", "deliver"]);
    expect(result.ok).toBe(true);
    expect(m.current()).toBe("delivered");
  });

  it("rejects an illegal transition and preserves state", () => {
    const m = new OrderMachine();
    const result = m.apply("ship"); // cannot ship straight from cart
    expect(result.ok).toBe(false);
    expect(m.current()).toBe("cart");
  });

  it("does not allow shipping a delivered order", () => {
    const m = new OrderMachine();
    m.run(["place", "pay", "ship", "deliver"]);
    expect(m.canApply("ship")).toBe(false);
  });
});
