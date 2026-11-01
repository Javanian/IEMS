import test from 'node:test';
import assert from 'node:assert/strict';
import { operatorFailure } from '../../../apps/web/src/features/portfolio/operator.mjs';

test('invalid credentials invite correction without identifying a valid account', () => {
  const message = operatorFailure({ status: 401, code: 'INVALID_CREDENTIALS' }, true);
  assert.match(message, /Check your username and password/);
  assert.doesNotMatch(message, /expired|unknown user|incorrect password/i);
});

test('established session failures retain expiry guidance', () => {
  for (const code of ['UNAUTHENTICATED', 'SESSION_EXPIRED', 'SESSION_REVOKED', undefined]) {
    assert.equal(operatorFailure({ status: 401, code }, true), 'Your session expired. Sign in again to continue.');
  }
  assert.match(operatorFailure({ status: 403, code: 'SCOPE_DENIED' }), /permission/);
  assert.match(operatorFailure({ status: 503 }, true), /uncertain.*same command/);
});
