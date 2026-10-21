/**
 * Negative Acceptance Scenario E03: Expired or Superseded Quote Rejected
 * Verifies that attempting to convert an expired or superseded quotation revision
 * into a Sales Order is strictly rejected without partial state mutation.
 */

'use strict';

const e03NegativeFixture = {
  scenario_id: 'E03',
  scenario_name: 'Quote Expired or Superseded Rejection',

  case_a_superseded_revision: {
    name: 'Attempt to convert superseded revision 1 to Sales Order',
    quotation_id: 'QUO-2026-0412',
    attempted_revision_no: 1,
    revision_status: 'SUPERSEDED',
    superseded_by_revision_no: 2,
    order_creation_payload: {
      customer_party_id: 'PRT-CUST-NMR',
      quotation_id: 'QUO-2026-0412',
      quotation_revision_id: 'QUO-2026-0412-R1',
      order_date: '2026-04-14T11:00:00Z'
    },
    expected_result: {
      success: false,
      http_status: 422,
      error_code: 'QUOTE_REVISION_SUPERSEDED',
      error_message: 'Cannot create sales order from superseded quotation revision 1. Active revision is 2.',
      mutations_occurred: false
    }
  },

  case_b_expired_quote: {
    name: 'Attempt to accept an expired quotation revision',
    quotation_id: 'QUO-2026-0999',
    revision_no: 1,
    issued_date: '2026-01-10T00:00:00Z',
    expiry_date: '2026-02-10T23:59:59Z',
    acceptance_attempt_date: '2026-04-15T10:00:00Z',
    acceptance_payload: {
      quotation_id: 'QUO-2026-0999',
      quotation_revision_id: 'QUO-2026-0999-R1',
      accepted_by: 'Customer Buyer'
    },
    expected_result: {
      success: false,
      http_status: 422,
      error_code: 'QUOTE_EXPIRED',
      error_message: 'Quotation QUO-2026-0999 expired on 2026-02-10T23:59:59Z and cannot be accepted.',
      mutations_occurred: false
    }
  }
};

module.exports = { e03NegativeFixture };
