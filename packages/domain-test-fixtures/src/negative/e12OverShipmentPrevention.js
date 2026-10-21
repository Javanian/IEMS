/**
 * Negative Acceptance Scenario E12: Over-Shipment and Duplicate Serial Prevention
 * Verifies that:
 * 1. Attempting to ship more quantity than remaining on the sales order line is strictly rejected.
 * 2. Attempting to dispatch a serial number that has already been dispatched is rejected.
 */

'use strict';

const e12NegativeFixture = {
  scenario_id: 'E12',
  scenario_name: 'Over-Shipment and Duplicate Serial Dispatch Prevention',

  order_state: {
    sales_order_id: 'SO-2026-0881',
    line_no: 1,
    item_code: 'ASY-SLP-250-HC',
    ordered_qty: '10.0000',
    shipped_qty_to_date: '6.0000',
    remaining_shippable_qty: '4.0000',
    uom: 'UN',
    dispatched_serials: [
      'SN-2026-SLP-001',
      'SN-2026-SLP-002',
      'SN-2026-SLP-003',
      'SN-2026-SLP-004',
      'SN-2026-SLP-005',
      'SN-2026-SLP-006'
    ]
  },

  case_a_quantity_over_shipment: {
    name: 'Attempt to ship 5 units when only 4 remain open on Sales Order line',
    attempted_shipment: {
      sales_order_id: 'SO-2026-0881',
      sales_order_line_no: 1,
      attempted_qty: '5.0000',
      uom: 'UN'
    },
    expected_result: {
      success: false,
      http_status: 422,
      error_code: 'OVER_SHIPMENT_EXCEEDS_ORDERED_QUANTITY',
      error_message: 'Cannot ship 5.0000 UN for SO-2026-0881 line 1. Remaining shippable quantity is 4.0000 UN (Ordered: 10.0000, Already Shipped: 6.0000).',
      shipment_created: false
    }
  },

  case_b_duplicate_serial_dispatch: {
    name: 'Attempt to dispatch serial that was already shipped on a previous shipment',
    attempted_serial: 'SN-2026-SLP-001',
    prior_shipment_id: 'SHP-2026-0041',
    attempted_shipment_id: 'SHP-2026-0042',
    expected_result: {
      success: false,
      http_status: 409,
      error_code: 'SERIAL_ALREADY_DISPATCHED',
      error_message: 'Serial SN-2026-SLP-001 has already been dispatched under shipment SHP-2026-0041 and cannot be shipped again.',
      duplicate_prevented: true
    }
  }
};

module.exports = { e12NegativeFixture };
