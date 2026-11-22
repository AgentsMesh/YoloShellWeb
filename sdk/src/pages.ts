/** Page cursors are opaque protocol values; only the owning Hub interprets them. */
export type PageCursor = unknown;
type ReadPage = (after: PageCursor) => Promise<Record<string, unknown>>;
export type CollectedPages = { rows: unknown[]; complete: boolean };

const PAGE_LIMIT = 64;

/**
 * Collect every row of a paged catalogue reply. The first read uses `null` and
 * every later read receives the previous reply's `next` cursor unchanged. A
 * stalled cursor stops the walk and `PAGE_LIMIT` bounds a server that never
 * reports the end. Only an uninterrupted walk to an explicit null cursor
 * provides a complete observation.
 */
export async function observePages(key: string, read: ReadPage): Promise<CollectedPages> {
  const rows: unknown[] = [];
  const cursors = new Set<string>();
  let valid = true;
  let after: PageCursor = null;
  for (let page = 0; page < PAGE_LIMIT; page++) {
    const reply = await read(after);
    const batch = reply[key];
    if (Array.isArray(batch)) rows.push(...batch);
    else valid = false;
    const next = reply.next ?? null;
    if (next === null) return { rows, complete: valid && reply.next === null };
    const cursor = JSON.stringify(next);
    if (cursor === JSON.stringify(after)) break;
    if (cursors.has(cursor)) valid = false;
    cursors.add(cursor);
    after = next;
  }
  return { rows, complete: false };
}

export async function collectPages(key: string, read: ReadPage): Promise<unknown[]> {
  return (await observePages(key, read)).rows;
}
