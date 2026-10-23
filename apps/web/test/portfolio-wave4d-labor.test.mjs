import test from 'node:test';
import assert from 'node:assert/strict';
import { laborCommand } from '../src/features/portfolio/labor.mjs';
test('self-recorded labor preserves exact UTC and integer milliseconds without hour conversion', () => {
  const values = { startedAt:'2026-10-23T01:00:00.001Z', endedAt:'2026-10-23T01:00:01.002Z', durationMs:'1001', evidence:'Measured operator evidence' };
  assert.deepEqual(laborCommand({_id:'wo',version:7,laborCount:1},values,'key','self'),{expectedVersion:7,idempotencyKey:'key',operationIndex:1,operatorId:'self',...values,durationMs:1001});
});
