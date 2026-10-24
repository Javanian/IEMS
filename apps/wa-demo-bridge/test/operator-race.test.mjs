import test from 'node:test';
import assert from 'node:assert/strict';
import { createFoundationOperatorAdapter } from '../src/foundation-operator.mjs';
test('operator adapter configuration is explicit and cannot omit foundation scope', () => {
  assert.throws(() => createFoundationOperatorAdapter({}), /Explicit foundation/);
});
