import { describe, it, expect } from "vitest";
import { OrderMachine } from "./src/machine";

// Target test — currently FAILS because a paid order cannot be cancelled
// (the `cancel` edge is missing from the `paid` state in transitions.ts).
describe("OrderMachine cancel-after-pay", () => {
  it("allows cancelling a paid order", () => {
    const m = new OrderMachine();
    m.run(["place", "pay"]);
    expect(m.current()).toBe("paid");
    expect(m.canApply("cancel")).toBe(true);

    const result = m.apply("cancel");
    expect(result.ok).toBe(true);
    expect(m.current()).toBe("cancelled");
  });

  it("cancels mid-sequence and stops further transitions", () => {
    const m = new OrderMachine();
    const result = m.run(["place", "pay", "cancel"]);
    expect(result.ok).toBe(true);
    expect(m.current()).toBe("cancelled");
  });
});
