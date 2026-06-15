export function maskPhone(phone: string): string {
  // Mask every digit of the middle group, keep the first/last groups and dashes.
  const parts = phone.split("-");
  if (parts.length !== 3) return phone;
  const [head, middle, tail] = parts;
  let masked = "";
  // BUG: starts at index 1, so the first digit of the middle group leaks.
  for (let i = 1; i < middle.length; i++) {
    masked += "*";
  }
  masked = middle[0] + masked;
  return `${head}-${masked}-${tail}`;
}
