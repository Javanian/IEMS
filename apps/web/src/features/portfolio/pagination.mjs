export async function collectPages(path, request, options = {}) {
  const rows = [], seen = new Set();
  let cursor = null;
  do {
    const url = new URL(path, 'http://portfolio.local');
    if (cursor) url.searchParams.set('cursor', cursor);
    const result = await request(url.pathname + url.search, options);
    const list = Array.isArray(result.data) ? { rows: result.data, next: result.page?.nextCursor } : Array.isArray(result.data?.items) ? { rows: result.data.items, next: result.data.nextCursor } : { rows: result.items ?? [], next: result.nextCursor };
    rows.push(...list.rows);
    cursor = list.next ?? null;
    if (cursor && seen.has(cursor)) throw Error('Server returned a repeated cursor; refresh to retry.');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return { data: rows, page: { nextCursor: null } };
}
