'use strict';

const { e03NegativeFixture } = require('./e03ExpiredQuoteRejected');
const { e04NegativeFixture } = require('./e04ShortageAndExpiredCalibration');
const { e05NegativeFixture } = require('./e05ConcurrentStockAllocation');
const { e06NegativeFixture } = require('./e06DuplicateIdempotencyKey');
const { e07LostUpdateConflict: e07NegativeFixture } = { e07LostUpdateConflict: require('./e07LostUpdateConflict').e07NegativeFixture };
const { e08NegativeFixture } = require('./e08CrossPlantBoundaryLeak');
const { e12NegativeFixture } = require('./e12OverShipmentPrevention');
const { e13NegativeFixture } = require('./e13DoubleBillingPrevention');

module.exports = {
  e03NegativeFixture,
  e04NegativeFixture,
  e05NegativeFixture,
  e06NegativeFixture,
  e07NegativeFixture,
  e08NegativeFixture,
  e12NegativeFixture,
  e13NegativeFixture
};
