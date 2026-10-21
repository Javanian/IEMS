/**
 * Negative Acceptance Scenario E05: Concurrent Stock Allocation
 * Verifies that concurrent reservation requests against limited inventory stock
 * never cause negative inventory balances.
 */

'use strict';

const e05NegativeFixture = {
  scenario_id: 'E05',
  scenario_name: 'Concurrent Stock Allocation and Race Condition Prevention',

  initial_inventory: {
    item_code: 'SEL-VTN-100',
    warehouse_id: 'WH-RAW-CKR',
    location_id: 'LOC-SEL-ROOM-01',
    lot_number: 'LOT-2026-SEL-110',
    on_hand_qty: '5.0000',
    allocated_qty: '0.0000',
    available_qty: '5.0000',
    uom: 'UN'
  },

  concurrent_requests: [
    {
      request_id: 'REQ-RES-USER-A',
      user_id: 'USER-PLNR-01',
      work_order_id: 'WO-2026-MFG-001',
      demanded_qty: '5.0000',
      timestamp: '2026-04-18T08:00:01.100Z',
      expected_outcome: {
        success: true,
        reserved_qty: '5.0000',
        resulting_stock_available: '0.0000'
      }
    },
    {
      request_id: 'REQ-RES-USER-B',
      user_id: 'USER-PLNR-02',
      work_order_id: 'WO-2026-MFG-002',
      demanded_qty: '5.0000',
      timestamp: '2026-04-18T08:00:01.102Z',
      expected_outcome: {
        success: false,
        http_status: 409,
        error_code: 'STOCK_ALLOCATION_EXHAUSTED',
        error_message: 'Cannot reserve 5.0000 UN of SEL-VTN-100: available stock is 0.0000 UN.',
        reserved_qty: '0.0000'
      }
    }
  ],

  invariant_guarantees: {
    minimum_available_qty: '0.0000',
    allow_negative_balance: false,
    isolation_mechanism: 'SELECT ... FOR UPDATE ON stock_position'
  }
};

module.exports = { e05NegativeFixture };
