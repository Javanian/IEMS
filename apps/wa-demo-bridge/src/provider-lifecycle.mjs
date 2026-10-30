const fail = code => { throw Object.assign(new Error(code), { status: 409 }); };

// An uncertain lifecycle keeps the durable reservation until operator reconciliation.
export function createProviderLifecycle({ registry, ownerId, adapter }) {
  if (typeof registry?.acquire !== 'function' || typeof registry?.release !== 'function'
    || typeof adapter?.open !== 'function' || typeof adapter?.close !== 'function'
    || typeof ownerId !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(ownerId)) {
    throw new Error('INVALID_PROVIDER_LIFECYCLE');
  }
  let state = 'IDLE';
  let ownership;
  const status = () => Object.freeze({ state, generation: ownership?.generation ?? null, externalSendEnabled: false });
  return Object.freeze({
    status,
    async start() {
      if (state !== 'IDLE' && state !== 'CLOSED') fail('PROVIDER_LIFECYCLE_BUSY');
      state = 'ACQUIRING';
      try {
        ownership = Object.freeze({ ...await registry.acquire(ownerId) });
        state = 'OPENING';
        // No ready hook or dispatch capability is passed to the adapter.
        await adapter.open(ownership);
        state = 'OPEN';
        return status();
      } catch {
        state = 'UNKNOWN';
        fail('PROVIDER_START_REQUIRES_RECONCILIATION');
      }
    },
    async stop() {
      if (state !== 'OPEN') fail('PROVIDER_LIFECYCLE_NOT_OPEN');
      state = 'CLOSING';
      try {
        const result = await adapter.close(ownership);
        if (result?.closed !== true) fail('PROVIDER_CLOSE_UNCONFIRMED');
        state = 'RELEASING';
        await registry.release({ ...ownership, adapterClosed: true });
        state = 'CLOSED';
        return status();
      } catch {
        state = 'UNKNOWN';
        fail('PROVIDER_STOP_REQUIRES_RECONCILIATION');
      }
    },
  });
}
