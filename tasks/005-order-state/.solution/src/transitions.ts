// The allowed order-lifecycle transitions, keyed by current state.
// Each entry maps an event name to the resulting next state.
export type OrderState = "cart" | "placed" | "paid" | "shipped" | "delivered" | "cancelled";
export type OrderEvent = "place" | "pay" | "ship" | "deliver" | "cancel";

export const TRANSITIONS: Record<OrderState, Partial<Record<OrderEvent, OrderState>>> = {
  cart: { place: "placed" },
  placed: { pay: "paid", cancel: "cancelled" },
  // A paid order must still be cancellable (refund) before it ships.
  paid: { ship: "shipped", cancel: "cancelled" },
  shipped: { deliver: "delivered" },
  delivered: {},
  cancelled: {},
};

export function nextState(state: OrderState, event: OrderEvent): OrderState | undefined {
  return TRANSITIONS[state]?.[event];
}
