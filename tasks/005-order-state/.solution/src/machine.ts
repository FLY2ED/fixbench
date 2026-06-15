import { nextState, type OrderEvent, type OrderState } from "./transitions";

export type ApplyResult =
  | { ok: true; state: OrderState }
  | { ok: false; state: OrderState; error: string };

// A tiny order state machine that drives transitions through the table in transitions.ts.
export class OrderMachine {
  constructor(private state: OrderState = "cart") {}

  current(): OrderState {
    return this.state;
  }

  canApply(event: OrderEvent): boolean {
    return nextState(this.state, event) !== undefined;
  }

  apply(event: OrderEvent): ApplyResult {
    const next = nextState(this.state, event);
    if (next === undefined) {
      return { ok: false, state: this.state, error: `cannot ${event} from ${this.state}` };
    }
    this.state = next;
    return { ok: true, state: this.state };
  }

  // Apply a sequence of events, stopping at the first illegal one.
  run(events: OrderEvent[]): ApplyResult {
    let result: ApplyResult = { ok: true, state: this.state };
    for (const event of events) {
      result = this.apply(event);
      if (!result.ok) break;
    }
    return result;
  }
}
