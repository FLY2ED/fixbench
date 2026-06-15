export function parseDuration(input: string): number {
  const re = /(\d+)\s*(h|m|s)/g;
  let total = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) {
    const n = Number(match[1]);
    const unit = match[2];
    if (unit === "h") total += n * 3600;
    else if (unit === "m") total += n * 60;
    else total += n;
  }
  return total;
}
