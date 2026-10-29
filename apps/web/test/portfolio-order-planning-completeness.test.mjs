import test from 'node:test';
import assert from 'node:assert/strict';
import { collectPages } from '../src/features/portfolio/pagination.mjs';

test('collectPages retains a target record after 100 unrelated rows (helper, not rendering)', async () => {
  const targetOrderId = 'so-target-multipage-1';
  const requestedUrls = [];

  const mockRequest = async (path, options = {}) => {
    requestedUrls.push(path);
    const url = new URL(path, 'http://portfolio.local');
    const cursor = url.searchParams.get('cursor');

    if (!cursor) {
      // Page 1: 100 work orders for another sales order
      const page1Rows = Array.from({ length: 100 }, (_, i) => ({
        _id: `wo-page1-${i + 1}`,
        salesOrderId: 'so-other-account',
        lineIndex: 0,
        status: 'PLANNED',
        quantity: '1.000',
        uom: 'EA',
      }));
      return { data: page1Rows, page: { nextCursor: 'cursor-token-page-2' } };
    }

    if (cursor === 'cursor-token-page-2') {
      // Page 2: 15 work orders, target sales order exists here
      const page2Rows = [
        {
          _id: 'wo-target-found-p2',
          salesOrderId: targetOrderId,
          lineIndex: 1,
          status: 'RELEASED',
          quantity: '42.500',
          uom: 'KG',
        },
        ...Array.from({ length: 14 }, (_, i) => ({
          _id: `wo-page2-${i + 1}`,
          salesOrderId: 'so-other-account',
          lineIndex: 0,
          status: 'PLANNED',
          quantity: '2.000',
          uom: 'EA',
        })),
      ];
      return { data: page2Rows, page: { nextCursor: null } };
    }

    throw new Error(`Unexpected cursor: ${cursor}`);
  };

  const completeResult = await collectPages('/api/manufacturing/work-orders?limit=100', mockRequest);
  assert.equal(completeResult.data.length, 115, 'Total traversed rows must equal 115 across pages');
  assert.equal(requestedUrls.length, 2, 'Exactly 2 pages requested');
  assert.equal(requestedUrls[0], '/api/manufacturing/work-orders?limit=100');
  assert.equal(requestedUrls[1], '/api/manufacturing/work-orders?limit=100&cursor=cursor-token-page-2');

  const target = completeResult.data[100];
  assert.equal(target._id, 'wo-target-found-p2');
  assert.equal(target.salesOrderId, targetOrderId);
  assert.equal(target.quantity, '42.500');
  assert.equal(target.uom, 'KG');
  assert.equal(target.status, 'RELEASED');
  assert.equal(target.lineIndex, 1);
});

test('collectPages preserves row order and exact domain fields across three pages', async () => {
  const targetOrderId = 'so-target-span-pages';
  const requestedUrls = [];

  const mockRequest = async path => {
    requestedUrls.push(path);
    const url = new URL(path, 'http://portfolio.local');
    const cursor = url.searchParams.get('cursor');

    if (!cursor) {
      // Page 1: 100 items (2 matching targetOrderId, 98 unrelated)
      const rows = [
        { _id: 'wo-span-1', salesOrderId: targetOrderId, lineIndex: 0, status: 'PLANNED', quantity: '10.500', uom: 'EA' },
        { _id: 'wo-span-2', salesOrderId: targetOrderId, lineIndex: 0, status: 'RELEASED', quantity: '5.250', uom: 'EA' },
        ...Array.from({ length: 98 }, (_, i) => ({
          _id: `wo-p1-unrelated-${i}`,
          salesOrderId: `so-unrelated-${i}`,
          lineIndex: 0,
          status: 'PLANNED',
          quantity: '1.000',
          uom: 'EA',
        })),
      ];
      return { data: rows, page: { nextCursor: 'page-2-cursor' } };
    }

    if (cursor === 'page-2-cursor') {
      // Page 2: 100 items (1 matching targetOrderId, 99 unrelated)
      const rows = [
        { _id: 'wo-span-3', salesOrderId: targetOrderId, lineIndex: 1, status: 'IN_PROGRESS', quantity: '20.000', uom: 'EA' },
        ...Array.from({ length: 99 }, (_, i) => ({
          _id: `wo-p2-unrelated-${i}`,
          salesOrderId: `so-unrelated-p2-${i}`,
          lineIndex: 0,
          status: 'PLANNED',
          quantity: '3.000',
          uom: 'EA',
        })),
      ];
      return { data: rows, page: { nextCursor: 'page-3-cursor' } };
    }

    if (cursor === 'page-3-cursor') {
      // Page 3: 10 items (1 matching targetOrderId, 9 unrelated)
      const rows = [
        { _id: 'wo-span-4', salesOrderId: targetOrderId, lineIndex: 2, status: 'QC_COMPLETED', quantity: '7.125', uom: 'EA' },
        ...Array.from({ length: 9 }, (_, i) => ({
          _id: `wo-p3-unrelated-${i}`,
          salesOrderId: `so-unrelated-p3-${i}`,
          lineIndex: 0,
          status: 'PLANNED',
          quantity: '1.000',
          uom: 'EA',
        })),
      ];
      return { data: rows, page: { nextCursor: null } };
    }

    throw new Error(`Unexpected cursor: ${cursor}`);
  };

  const completeResult = await collectPages('/api/manufacturing/work-orders?limit=100', mockRequest);
  assert.equal(completeResult.data.length, 210, 'Total traversed rows must equal 210 across 3 pages');
  assert.equal(requestedUrls.length, 3, 'All 3 pages were fetched');

  const matchingRows = [0, 1, 100, 200].map(index => completeResult.data[index]);

  assert.deepEqual(matchingRows.map(w => w._id), ['wo-span-1', 'wo-span-2', 'wo-span-3', 'wo-span-4']);
  assert.deepEqual(matchingRows.map(w => w.quantity), ['10.500', '5.250', '20.000', '7.125']);
  assert.deepEqual(matchingRows.map(w => w.status), ['PLANNED', 'RELEASED', 'IN_PROGRESS', 'QC_COMPLETED']);
  assert.deepEqual(matchingRows.map(w => w.lineIndex), [0, 0, 1, 2]);

  assert.equal(completeResult.data[2].salesOrderId, 'so-unrelated-0');
  assert.equal(completeResult.data[101].salesOrderId, 'so-unrelated-p2-0');
});

test('collectPages returns all unrelated records for the component to decide empty state', async () => {
  const targetOrderId = 'so-with-no-work-orders';
  const requestedUrls = [];

  const mockRequest = async path => {
    requestedUrls.push(path);
    const url = new URL(path, 'http://portfolio.local');
    const cursor = url.searchParams.get('cursor');

    if (!cursor) {
      return {
        data: Array.from({ length: 100 }, (_, i) => ({
          _id: `wo-${i}`,
          salesOrderId: 'so-different-order',
          lineIndex: 0,
          status: 'PLANNED',
          quantity: '1.000',
          uom: 'EA',
        })),
        page: { nextCursor: 'cursor-for-page-2' },
      };
    }

    if (cursor === 'cursor-for-page-2') {
      return {
        data: Array.from({ length: 50 }, (_, i) => ({
          _id: `wo-p2-${i}`,
          salesOrderId: 'so-different-order',
          lineIndex: 0,
          status: 'PLANNED',
          quantity: '1.000',
          uom: 'EA',
        })),
        page: { nextCursor: null },
      };
    }

    throw new Error(`Unexpected cursor: ${cursor}`);
  };

  const completeResult = await collectPages('/api/manufacturing/work-orders?limit=100', mockRequest);
  assert.equal(completeResult.data.length, 150);
  assert.equal(requestedUrls.length, 2);

  assert.ok(completeResult.data.every(row => row.salesOrderId !== targetOrderId));
});

test('collectPages rejects later-page failure and repeated cursor without partial return', async () => {
  // Case A: Page 2 throws a server error
  const failingRequest = async path => {
    const url = new URL(path, 'http://portfolio.local');
    const cursor = url.searchParams.get('cursor');

    if (!cursor) {
      return {
        data: [{ _id: 'wo-1', salesOrderId: 'so-1', status: 'PLANNED', quantity: '1', uom: 'EA', lineIndex: 0 }],
        page: { nextCursor: 'next-page-fails' },
      };
    }

    const err = new Error('Database connection reset while reading next cursor page');
    err.status = 500;
    throw err;
  };

  await assert.rejects(
    collectPages('/api/manufacturing/work-orders?limit=100', failingRequest),
    err => {
      assert.equal(err.status, 500);
      assert.match(err.message, /Database connection reset/);
      return true;
    },
    'Later page failure must reject completely, never returning page 1 partial data'
  );

  // Case B: Server returns repeated cursor
  const repeatingRequest = async path => {
    const url = new URL(path, 'http://portfolio.local');
    const cursor = url.searchParams.get('cursor');

    if (!cursor) {
      return {
        data: [{ _id: 'wo-1', salesOrderId: 'so-1', status: 'PLANNED', quantity: '1', uom: 'EA', lineIndex: 0 }],
        page: { nextCursor: 'stuck-cursor' },
      };
    }

    return {
      data: [{ _id: 'wo-2', salesOrderId: 'so-1', status: 'PLANNED', quantity: '1', uom: 'EA', lineIndex: 0 }],
      page: { nextCursor: 'stuck-cursor' },
    };
  };

  await assert.rejects(
    collectPages('/api/manufacturing/work-orders?limit=100', repeatingRequest),
    /repeated cursor/,
    'Repeated cursor must throw error and prevent infinite loop or partial acceptance'
  );
});

test('collectPages forwards the exact AbortSignal on every page and rejects AbortError', async () => {
  const controller = new AbortController();
  let abortedSeenInRequest = false, calls = 0;

  const abortableRequest = async (path, options = {}) => {
    calls++;
    assert.equal(options.signal, controller.signal);
    if (options.signal?.aborted) {
      abortedSeenInRequest = true;
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      throw abortError;
    }

    const url = new URL(path, 'http://portfolio.local');
    const cursor = url.searchParams.get('cursor');

    if (!cursor) {
      // Abort after first page is returned, before second page fetch completes
      controller.abort();
      return {
        data: [{ _id: 'wo-1', salesOrderId: 'so-target', status: 'PLANNED', quantity: '1', uom: 'EA', lineIndex: 0 }],
        page: { nextCursor: 'page-2' },
      };
    }

    if (options.signal?.aborted) {
      abortedSeenInRequest = true;
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      throw abortError;
    }

    return { data: [], page: { nextCursor: null } };
  };

  await assert.rejects(
    collectPages('/api/manufacturing/work-orders?limit=100', abortableRequest, { signal: controller.signal }),
    err => err.name === 'AbortError'
  );

  assert.equal(calls, 2);
  assert.equal(abortedSeenInRequest, true);
});

test('collectPages rejects an abort while its next-page request is pending', { timeout: 2000 }, async () => {
  const controller = new AbortController();
  let entered;
  const nextPage = new Promise(resolve => { entered = resolve; });
  const request = async (path, options) => {
    assert.equal(options.signal, controller.signal);
    if (!path.includes('cursor=')) return { data: [], page: { nextCursor: 'pending' } };
    return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
      entered();
    });
  };
  const load = collectPages('/api/manufacturing/work-orders?limit=100', request, { signal: controller.signal });
  await nextPage;
  controller.abort();
  await assert.rejects(load, error => error.name === 'AbortError');
});
