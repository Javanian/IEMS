/**
 * Negative Acceptance Scenario E07: Lost Update 409 Conflict
 * Verifies that optimistic concurrency checks via version/ETag prevent
 * silent overwrites when two sessions edit an aggregate concurrently.
 */

'use strict';

const e07NegativeFixture = {
  scenario_id: 'E07',
  scenario_name: 'Optimistic Concurrency Control and Lost Update 409 Conflict',

  resource_type: 'QUOTATION_REVISION',
  resource_id: 'QUO-2026-0412-R2',

  baseline_state: {
    resource_id: 'QUO-2026-0412-R2',
    version: 3,
    lead_time_days: 45,
    unit_price: '12250.00',
    notes: 'Standard 45-day lead time revision'
  },

  session_b_mutation_committed: {
    actor_id: 'USER-SALES-B',
    expected_previous_version: 3,
    mutation_payload: {
      lead_time_days: 40,
      notes: 'Customer negotiation accelerated lead time to 40 days'
    },
    resulting_state: {
      version: 4,
      lead_time_days: 40,
      notes: 'Customer negotiation accelerated lead time to 40 days'
    },
    http_status: 200
  },

  session_a_stale_mutation_attempt: {
    actor_id: 'USER-SALES-A',
    provided_version: 3, // Stale version! (current is now 4)
    mutation_payload: {
      unit_price: '12100.00',
      notes: 'Applying additional 150 USD discount'
    },
    expected_result: {
      success: false,
      http_status: 409,
      error_code: 'OPTIMISTIC_LOCK_LOST_UPDATE',
      error_message: 'Resource QUO-2026-0412-R2 has been modified by another transaction. Expected version 3, but current database version is 4.',
      current_version: 4,
      diff: {
        field: 'lead_time_days',
        current_value: 40,
        your_baseline: 45
      },
      overwrite_prevented: true
    }
  }
};

module.exports = { e07NegativeFixture };
