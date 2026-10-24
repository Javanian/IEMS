import test from 'node:test';
import assert from 'node:assert/strict';
import { collectPages } from '../src/features/portfolio/pagination.mjs';

test('complete source traversal retains opaque cursors and rejects incomplete results', async () => {
  const paths = [];
  const result = await collectPages('/api/source?limit=100', async path => {
    paths.push(path);
    return paths.length === 1 ? { data: Array.from({ length: 100 }, (_, _id) => ({ _id })), page: { nextCursor: 'opaque+/=' } } : { data: [{ _id: 100 }], page: { nextCursor: null } };
  });
  assert.equal(result.data.length, 101);
  assert.equal(paths[1], '/api/source?limit=100&cursor=opaque%2B%2F%3D');
  await assert.rejects(collectPages('/api/source', async () => ({ data: [], page: { nextCursor: 'repeat' } })), /repeated cursor/);
});
