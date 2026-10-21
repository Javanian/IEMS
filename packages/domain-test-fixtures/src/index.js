'use strict';

const decimal = require('./decimal');
const { masterData } = require('./common/masterData');
const { e01ManufacturingFixture } = require('./scenarios/e01ManufacturingTenUnits');
const { e02RepairFixture } = require('./scenarios/e02RepairCustomerAsset');
const negativeFixtures = require('./negative');
const validation = require('./validation');

module.exports = {
  decimal,
  masterData,
  e01ManufacturingFixture,
  e02RepairFixture,
  negativeFixtures,
  validation
};
