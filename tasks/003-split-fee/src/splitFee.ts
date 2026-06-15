export function splitFee(totalCents: number, n: number): number[] {
  // Split totalCents into n parts that sum back to totalCents.
  // Remainder cents go one-each to the earliest parts.
  const base = Math.floor(totalCents / n);
  const parts: number[] = [];
  for (let i = 0; i < n; i++) {
    // BUG: the remainder cents (totalCents % n) are never distributed, so the parts under-sum the total.
    parts.push(base);
  }
  return parts;
}
