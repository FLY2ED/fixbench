export function paginate<T>(items: T[], page: number, pageSize: number): T[] {
  // page is 1-based. Page 1 -> items[0 .. pageSize-1], page 2 -> next pageSize, etc.
  const start = (page - 1) * pageSize;
  const end = start + pageSize - 1; // BUG: slice end is exclusive, so this drops the last item of each page
  return items.slice(start, end);
}
