export function splitFee(totalCents: number, n: number): number[] {
  // Split totalCents into n parts that sum back to totalCents.
  // Remainder cents go one-each to the earliest parts.
  const base = Math.floor(totalCents / n);
  const remainder = totalCents % n;
  const parts: number[] = [];
  for (let i = 0; i < n; i++) {
    parts.push(base + (i < remainder ? 1 : 0));
  }
  return parts;
}
