// Explicit test/demo inputs; never an authoritative order lookup or automatic seed.
export function serviceOrderFixtures({ plantId, customerId, at = new Date('2026-01-01T00:00:00.000Z') }) {
  if (!(at instanceof Date) || !Number.isFinite(at.getTime())) throw new TypeError('Invalid fixture date');
  const milestone = (code, label, state) => ({ code, label, state, at: state === 'DONE' ? new Date(at) : null });
  return [
    { plantId, customerId, orderNumber: 'SO-SYNTHETIC-001', publicStage: 'PRODUCTION', kind: 'MANUFACTURE',
      progress: { released: 2, total: 3 }, confirmedDates: {}, milestones: [
        milestone('ACCEPTED', 'Order accepted', 'DONE'), milestone('PRODUCTION', 'In production', 'CURRENT'),
        milestone('SHIPPED', 'Shipped', 'PENDING'),
      ] },
    { plantId, customerId, orderNumber: 'RP-SYNTHETIC-001', publicStage: 'DIAGNOSIS', kind: 'REPAIR',
      progress: null, confirmedDates: {}, milestones: [
        milestone('RECEIVED', 'Received for repair', 'DONE'), milestone('DIAGNOSIS', 'Diagnosis', 'CURRENT'),
        milestone('AWAITING_APPROVAL', 'Awaiting your approval', 'PENDING'), milestone('RETURNED', 'Returned', 'PENDING'),
      ] },
  ];
}
