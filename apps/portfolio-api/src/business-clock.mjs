export function businessNow(runtime) {
  const instant = runtime.businessClock ? runtime.businessClock() : new Date();
  const result = new Date(instant);
  if (!Number.isFinite(result.getTime())) throw new Error('Invalid synthetic business clock');
  return result;
}

export async function bindBusinessClock(runtime, clock, marker) {
  if (clock === undefined) return;
  if (typeof clock !== 'function' || typeof marker !== 'string' || !/^portfolio_(owned|test)_/.test(runtime.db.databaseName) || !await runtime.db.collection('ownedRun').findOne({ _id: marker })) {
    throw Object.assign(new Error('Owned marker is required for synthetic business-clock replay'), { status: 403, code: 'OWNED_DATABASE_REQUIRED' });
  }
  businessNow({ businessClock: clock });
  runtime.businessClock = clock;
  runtime.businessClockMode = 'SYNTHETIC_BUSINESS_CLOCK_REPLAY';
}
