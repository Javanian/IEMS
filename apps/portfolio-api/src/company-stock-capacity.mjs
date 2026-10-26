export const companyStockLimits = Object.freeze({ reservations: 100, events: 500 });

export function companyStockCapacity(version, reservationCount) {
  if (!Number.isSafeInteger(version) || version < 1 || !Number.isSafeInteger(reservationCount) || reservationCount < 0) {
    throw new TypeError('Company stock capacity requires validated version and reservation count');
  }
  const eventCount = version - 1;
  return {
    reservationCount,
    reservationLimit: companyStockLimits.reservations,
    remainingReservationSlots: Math.max(0, companyStockLimits.reservations - reservationCount),
    eventCount,
    eventLimit: companyStockLimits.events,
    remainingEvents: Math.max(0, companyStockLimits.events - eventCount),
    reservationLimitReached: reservationCount >= companyStockLimits.reservations,
    eventLimitReached: eventCount >= companyStockLimits.events,
  };
}
