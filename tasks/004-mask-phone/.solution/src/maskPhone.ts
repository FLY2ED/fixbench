export function maskPhone(phone: string): string {
  // Mask every digit of the middle group, keep the first/last groups and dashes.
  const parts = phone.split("-");
  if (parts.length !== 3) return phone;
  const [head, middle, tail] = parts;
  let masked = "";
  for (let i = 0; i < middle.length; i++) {
    masked += "*";
  }
  return `${head}-${masked}-${tail}`;
}
