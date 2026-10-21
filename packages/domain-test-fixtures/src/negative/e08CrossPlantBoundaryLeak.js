/**
 * Negative Acceptance Scenario E08: Cross-Plant Boundary Leak Prevention
 * Verifies that users and transactions scoped to Plant A cannot read or mutate
 * resources belonging to Plant B, and that sensitive metadata is never leaked.
 */

'use strict';

const e08NegativeFixture = {
  scenario_id: 'E08',
  scenario_name: 'Cross-Plant Scoping and Multi-Tenant Isolation',

  requesting_actor: {
    user_id: 'USER-PLNR-CKR',
    authorized_plant_id: 'PLANT-CKR',
    role: 'PRODUCTION_PLANNER'
  },

  target_resources: {
    work_order_plant_b: {
      id: 'WO-2026-RPR-0055',
      plant_id: 'PLANT-BPN',
      legal_entity_id: 'LE-ID-001',
      description: 'Caterpillar 793D Cylinder Overhaul'
    },
    repair_case_plant_b: {
      id: 'CASE-2026-RPR-0055',
      plant_id: 'PLANT-BPN',
      description: 'Confidential Mining Client Teardown Report'
    },
    attachment_plant_b: {
      id: 'ATT-CONF-BPN-99',
      plant_id: 'PLANT-BPN',
      filename: 'KPC-Teardown-Analysis-Proprietary.pdf'
    }
  },

  unauthorized_actions: [
    {
      action: 'READ_WORK_ORDER',
      endpoint: '/api/v1/work-orders/WO-2026-RPR-0055',
      attempted_resource_id: 'WO-2026-RPR-0055',
      expected_result: {
        http_status: 404, // 404 Not Found to prevent resource enumeration
        error_code: 'RESOURCE_NOT_FOUND_OR_FORBIDDEN',
        error_message: 'Work order WO-2026-RPR-0055 was not found within authorized plant scope PLANT-CKR.',
        leaked_metadata: null
      }
    },
    {
      action: 'MUTATE_REPAIR_CASE',
      endpoint: '/api/v1/repair-cases/CASE-2026-RPR-0055/notes',
      attempted_resource_id: 'CASE-2026-RPR-0055',
      payload: { note: 'Attempting cross-plant annotation from CKR planner' },
      expected_result: {
        http_status: 403,
        error_code: 'CROSS_PLANT_ACCESS_DENIED',
        error_message: 'Actor authorization scope PLANT-CKR does not permit mutations on resource belonging to PLANT-BPN.',
        mutation_applied: false
      }
    },
    {
      action: 'DOWNLOAD_ATTACHMENT',
      endpoint: '/api/v1/attachments/ATT-CONF-BPN-99/download',
      attempted_resource_id: 'ATT-CONF-BPN-99',
      expected_result: {
        http_status: 404,
        error_code: 'ATTACHMENT_ACCESS_DENIED',
        error_message: 'Attachment not found or access denied.',
        leaked_filename: null
      }
    }
  ]
};

module.exports = { e08NegativeFixture };
