/**
 * Scenario E02: Customer Asset Repair End-to-End and Rejection Variant
 * Complete, deterministic domain test fixture.
 *
 * Sequence (Main Repair Flow):
 * 1. Customer Asset Intake (AST-CAT-793D-CYL-88412, serial 793D-SUSP-B2199, customer owned)
 * 2. Repair Case Intake & Custody Event (CASE-2026-RPR-0055, CUST-EVT-001)
 * 3. Diagnostic Authorization (DIAG-AUTH-2026-055, fee cap 1,200.00 USD)
 * 4. Teardown Findings (Barrel: REUSE, Piston: REPAIR, Seal kit: REPLACE)
 * 5. Quotation Rev 1 (Budgetary) & Rev 2 (Revised Teardown Scope: 9,000.00 USD net)
 * 6. Customer Scope Authorization & Quote Rev 2 Acceptance
 * 7. Customer Prepayment / Deposit (3,000.00 USD)
 * 8. Repair Sales Order & Repair Work Order (WO-2026-RPR-0055)
 * 9. Inventory Issue of replacement seal kit from company stock
 * 10. Assembly & Functional Test Run 1 (FAILS: pressure drop on hydrostatic test)
 * 11. Non-Conformance Report (NCR-2026-RPR-014) & Rework Order (RWK-2026-055-01)
 * 12. Functional Test Run 2 (PASSES: zero pressure drop hold 30 min)
 * 13. Final QC Inspection Release (QC-REL-RPR-0055)
 * 14. Return Shipment (SHP-2026-RPR-001, mode CUSTOMER_ASSET_RETURN) & POD
 * 15. Custody Event (CUST-EVT-002, custody transferred back to customer)
 * 16. Final Invoice (9,000.00 USD net + 990.00 USD VAT = 9,990.00 USD gross)
 * 17. Deposit Application (3,000.00 USD from prepayment applied to final invoice)
 * 18. Final Payment (6,990.00 USD settling invoice balance to 0.00 USD)
 * 19. Warranty Linkage (WAR-2026-055 linking serial, repair WO, invoice)
 *
 * Sequence (Rejection Variant):
 * - Customer REJECTS Quote Rev 2
 * - Repair Work Order CANCELLED
 * - Diagnostic Fee Invoice (1,200.00 USD net + 132.00 USD VAT = 1,332.00 USD gross)
 * - Diagnostic Fee Payment (1,332.00 USD settling invoice)
 * - Return-Unrepaired Shipment & POD (Disassembled crated unit returned to customer)
 */

'use strict';

const e02RepairFixture = {
  scenario_id: 'E02',
  scenario_name: 'Customer Asset Repair End-to-End with Teardown, Rework, Deposit Application, Warranty, and Rejection Variant',
  legal_entity_id: 'LE-ID-001',
  plant_id: 'PLANT-BPN',
  customer_party_id: 'PRT-CUST-KPC',

  customer_asset: {
    id: 'AST-CAT-793D-CYL-88412',
    serial_no: '793D-SUSP-B2199',
    asset_tag: 'KPC-EQP-793D-041-LH',
    description: 'Caterpillar 793D Rear Suspension Cylinder LH',
    manufacturer: 'Caterpillar Inc.',
    model_number: '793D-SUSP-HVY',
    ownership_type: 'CUSTOMER_OWNED',
    owner_party_id: 'PRT-CUST-KPC',
    current_custody_plant_id: 'PLANT-BPN',
    original_equipment_hours: 14280
  },

  repair_case: {
    id: 'CASE-2026-RPR-0055',
    case_number: 'RPR-2026-0055',
    asset_id: 'AST-CAT-793D-CYL-88412',
    customer_party_id: 'PRT-CUST-KPC',
    intake_plant_id: 'PLANT-BPN',
    intake_date: '2026-05-08T09:00:00Z',
    status: 'COMPLETED',
    customer_reported_fault: 'Excessive hydraulic oil weeping at gland seal and abnormal chatter under load',
    initial_condition: {
      received_condition: 'HEAVILY_CONTAMINATED',
      fluid_drained_liters: '38.5',
      external_damage: 'Chrome pitting and deep axial score marks on rod, oil weeping past gland seal',
      accessories_included: ['Trunnion mounting pins (2 pcs)', 'Flange adapter split ring']
    },
    custody_events: [
      {
        id: 'CUST-EVT-001',
        event_type: 'RECEIVING_INTAKE',
        plant_id: 'PLANT-BPN',
        location_id: 'LOC-INTK-01',
        actor_id: 'EMP-0701',
        timestamp: '2026-05-08T09:30:00Z',
        from_holder: 'PT Kaltim Prima Coal (Mine Delivery Driver)',
        to_holder: 'PT IEMS Indonesia (Balikpapan Receiving)',
        custody_state: 'IN_CUSTODY_IEMS'
      },
      {
        id: 'CUST-EVT-002',
        event_type: 'DISPATCH_RETURN',
        plant_id: 'PLANT-BPN',
        location_id: 'LOC-RET-01',
        actor_id: 'EMP-0705',
        timestamp: '2026-05-31T14:00:00Z',
        from_holder: 'PT IEMS Indonesia (Balikpapan Dispatch)',
        to_holder: 'PT Kaltim Prima Coal (Sangatta Warehouse Receiving)',
        custody_state: 'RETURNED_TO_CUSTOMER'
      }
    ]
  },

  diagnostic_authorization: {
    id: 'DIAG-AUTH-2026-055',
    case_id: 'CASE-2026-RPR-0055',
    authorized_by: 'Ir. Bambang Hermanto (KPC Mobile Maintenance Superintendent)',
    authorized_at: '2026-05-10T08:30:00Z',
    customer_po_reference: 'KPC-SRV-2026-0491',
    authorized_scope: 'Complete cylinder teardown, chemical degrease, dimensional laser bore check, MPI crack detection',
    capped_diagnostic_fee: '1200.00',
    currency: 'USD',
    status: 'AUTHORIZED'
  },

  teardown: {
    disassembly_event_id: 'DISASM-2026-01',
    repair_job_id: 'RJOB-2026-0055',
    workcenter_id: 'WC-BPN-INTAKE',
    technician_id: 'EMP-0701',
    completed_at: '2026-05-12T15:30:00Z',
    findings: [
      {
        finding_no: 1,
        component_name: 'Cylinder Barrel 310mm ID',
        component_serial_or_tag: 'CMP-793D-BARREL-01',
        condition_observation: 'Bore glaze present, max ovality 0.08mm within OEM re-hone limit (+0.15mm), MPI shows zero structural fatigue cracks',
        disposition: 'REUSE',
        recommended_action: 'Clean, deglaze, and precision hone bore to 310.05mm (+0.03/-0.00mm)'
      },
      {
        finding_no: 2,
        component_name: 'Piston Rod and Head Assembly',
        component_serial_or_tag: 'CMP-793D-PSTN-02',
        condition_observation: 'Hard chrome plating chipped and scored 0.35mm deep along 600mm stroke length, piston seal groove burred',
        disposition: 'REPAIR',
        recommended_action: 'Cylindrical grind to clean base metal (-0.40mm), hard-chrome plate 0.45mm thickness, finish grind and polish to 180.00mm (+0.00/-0.02mm)'
      },
      {
        finding_no: 3,
        component_name: 'Rod Seal, Wiper, and Buffer Gland Ring Kit',
        component_serial_or_tag: 'CMP-793D-SEAL-03',
        condition_observation: 'Primary polyurethane seal lip cracked, buffer ring extruded, gland O-rings flattened and hardened from heat cycling',
        disposition: 'REPLACE',
        recommended_action: 'Scrap old degraded seals and install new Parker OEM complete seal kit (Part KIT-SEAL-793D-OEM)'
      }
    ]
  },

  quotation: {
    id: 'QUO-2026-RPR-0055',
    quotation_number: 'QUO-2026-RPR-0055',
    legal_entity_id: 'LE-ID-001',
    plant_id: 'PLANT-BPN',
    customer_party_id: 'PRT-CUST-KPC',
    case_id: 'CASE-2026-RPR-0055',
    currency: 'USD',

    revisions: [
      {
        id: 'QUO-2026-RPR-0055-R1',
        revision_no: 1,
        status: 'SUPERSEDED',
        issued_date: '2026-05-09T14:00:00Z',
        expiry_date: '2026-05-24T23:59:59Z',
        notes: 'Preliminary budgetary estimate prior to teardown',
        superseded_by_revision_no: 2,
        superseded_reason: 'Updated with exact scope from physical teardown NDT inspection',
        lines: [
          {
            line_no: 1,
            description: 'Budgetary repair estimate for 793D suspension cylinder',
            unit_price: '9500.00',
            quoted_qty: '1.0000',
            uom: 'SET',
            net_amount: '9500.00',
            tax_rate: '0.11',
            tax_amount: '1045.00',
            total_amount: '10545.00'
          }
        ]
      },
      {
        id: 'QUO-2026-RPR-0055-R2',
        revision_no: 2,
        status: 'ACCEPTED',
        issued_date: '2026-05-13T10:00:00Z',
        expiry_date: '2026-05-28T23:59:59Z',
        notes: 'Firm fixed repair quotation based on confirmed teardown findings',
        required_advance_deposit_amount: '3000.00',
        superseded_by_revision_no: null,
        superseded_reason: null,
        lines: [
          {
            line_no: 1,
            description: 'Teardown, ultrasonic wash, MPI crack inspection, and dimensional analysis',
            unit_price: '1200.00',
            quoted_qty: '1.0000',
            uom: 'SET',
            net_amount: '1200.00',
            tax_rate: '0.11',
            tax_amount: '132.00',
            total_amount: '1332.00'
          },
          {
            line_no: 2,
            description: 'Precision cylinder barrel deglaze and hone bore to OEM tolerance',
            unit_price: '850.00',
            quoted_qty: '1.0000',
            uom: 'SET',
            net_amount: '850.00',
            tax_rate: '0.11',
            tax_amount: '93.50',
            total_amount: '943.50'
          },
          {
            line_no: 3,
            description: 'Piston rod cylindrical grind, hard-chrome plating 0.45mm, and precision finish polish',
            unit_price: '3400.00',
            quoted_qty: '1.0000',
            uom: 'SET',
            net_amount: '3400.00',
            tax_rate: '0.11',
            tax_amount: '374.00',
            total_amount: '3774.00'
          },
          {
            line_no: 4,
            description: 'New Parker OEM complete rod seal, wiper, buffer and gland kit (KIT-SEAL-793D-OEM)',
            unit_price: '2150.00',
            quoted_qty: '1.0000',
            uom: 'SET',
            net_amount: '2150.00',
            tax_rate: '0.11',
            tax_amount: '236.50',
            total_amount: '2386.50'
          },
          {
            line_no: 5,
            description: 'Cleanroom final assembly, rod gland torquing, and 700 Bar hydrostatic proof testing',
            unit_price: '1400.00',
            quoted_qty: '1.0000',
            uom: 'SET',
            net_amount: '1400.00',
            tax_rate: '0.11',
            tax_amount: '154.00',
            total_amount: '1554.00'
          }
        ],
        totals: {
          net_amount: '9000.00',
          tax_amount: '990.00',
          gross_amount: '9990.00'
        }
      }
    ]
  },

  scope_authorization: {
    id: 'AUTH-SCOPE-2026-055',
    quotation_id: 'QUO-2026-RPR-0055',
    quotation_revision_id: 'QUO-2026-RPR-0055-R2',
    customer_approval_doc: 'KPC-APPRV-RPR-8812',
    approved_by: 'Ir. Bambang Hermanto (KPC Mobile Maintenance Superintendent)',
    approved_at: '2026-05-14T11:20:00Z',
    authorized_net_amount: '9000.00',
    authorized_gross_amount: '9990.00',
    deposit_commitment: '3000.00',
    status: 'AUTHORIZED'
  },

  prepayment: {
    id: 'PRPAY-2026-055',
    customer_party_id: 'PRT-CUST-KPC',
    payment_reference: 'KPC-WIRE-DEP-20260515',
    received_at: '2026-05-15T09:10:00Z',
    currency: 'USD',
    initial_amount: '3000.00',
    applied_amount: '3000.00',
    remaining_balance: '0.00',
    status: 'FULLY_APPLIED',
    notes: 'Advance repair deposit for Cat 793D cylinder RPR-2026-0055'
  },

  repair_sales_order: {
    id: 'SO-2026-RPR-0055',
    order_number: 'SO-2026-RPR-0055',
    legal_entity_id: 'LE-ID-001',
    plant_id: 'PLANT-BPN',
    customer_party_id: 'PRT-CUST-KPC',
    order_date: '2026-05-15T11:00:00Z',
    order_type: 'REPAIR_SERVICE',
    target_customer_asset_id: 'AST-CAT-793D-CYL-88412',
    status: 'FULFILLED',
    lines: [
      {
        line_no: 1,
        description: 'Complete overhaul & re-chroming repair of Cat 793D suspension cylinder SN 793D-SUSP-B2199',
        ordered_qty: '1.0000',
        uom: 'SET',
        unit_price: '9000.00',
        net_amount: '9000.00',
        tax_rate: '0.11',
        tax_amount: '990.00',
        total_amount: '9990.00',
        quote_acceptance_id: 'AUTH-SCOPE-2026-055'
      }
    ]
  },

  billing_entitlement: {
    id: 'ENT-RPR-0055-01',
    sales_order_id: 'SO-2026-RPR-0055',
    sales_order_line_no: 1,
    authorized_net_cap: '9000.00',
    currency: 'USD',
    delivery_billed_net: '9000.00',
    milestone_billed_net: '0.00',
    remaining_billable_net: '0.00',
    status: 'FULLY_BILLED'
  },

  repair_work_order: {
    id: 'WO-2026-RPR-0055',
    order_number: 'WO-2026-RPR-0055',
    plant_id: 'PLANT-BPN',
    work_order_type: 'REPAIR',
    customer_asset_id: 'AST-CAT-793D-CYL-88412',
    sales_order_id: 'SO-2026-RPR-0055',
    status: 'COMPLETED',
    planned_start: '2026-05-16T08:00:00Z',
    actual_completion: '2026-05-28T16:30:00Z',
    operations: [
      { op_no: 10, name: 'Precision Barrel Honing', workcenter_id: 'WC-BPN-HONE', status: 'COMPLETED' },
      { op_no: 20, name: 'Rod Hard Chrome Plating & Grinding', workcenter_id: 'WC-BPN-CHROME', status: 'COMPLETED' },
      { op_no: 30, name: 'Cleanroom Cylinder Assembly', workcenter_id: 'WC-BPN-ASM', status: 'COMPLETED' },
      { op_no: 40, name: 'Hydrostatic Pressure Proof Test', workcenter_id: 'WC-BPN-TEST', status: 'COMPLETED' }
    ],
    material_issues: [
      {
        movement_id: 'MOV-RPR-055',
        source_warehouse_id: 'WH-SPR-BPN',
        item_code: 'KIT-SEAL-793D-OEM',
        lot_number: 'LOT-PRK-2026-09',
        qty: '1.0000',
        uom: 'SET',
        unit_cost: '1450.00',
        total_cost: '1450.00',
        posted_at: '2026-05-22T08:30:00Z'
      }
    ]
  },

  functional_testing: {
    run_1_failed: {
      test_order_id: 'TST-2026-055-01',
      work_order_id: 'WO-2026-RPR-0055',
      test_bench_id: 'WC-BPN-TEST',
      equipment_id: 'EQP-BPN-TEST-700',
      tested_by: 'EMP-0701',
      tested_at: '2026-05-24T14:00:00Z',
      target_pressure_bar: '350.0',
      hold_duration_minutes: 30,
      observed_pressure_drop_bar: '18.4',
      outcome: 'FAILED',
      failure_reason: 'Pressure dropped 18.4 bar in 4 minutes; oil weeping detected past rod wiper gland seal',
      non_conformance_report: {
        ncr_id: 'NCR-2026-RPR-014',
        root_cause: 'Secondary wiper seal backup ring pinched during initial gland torque tightening',
        severity: 'MAJOR_INTERNAL_DEFECT',
        disposition: 'REWORK'
      }
    },
    rework_order: {
      id: 'RWK-2026-055-01',
      parent_work_order_id: 'WO-2026-RPR-0055',
      ncr_id: 'NCR-2026-RPR-014',
      workcenter_id: 'WC-BPN-ASM',
      technician_id: 'EMP-0701',
      action_taken: 'Disassembled wiper gland, inspected gland seat, replaced damaged backup ring with new RNG-BKUP-04, and re-torqued evenly in cross-pattern to 185 Nm',
      rework_material: {
        item_code: 'RNG-BKUP-04',
        qty: '1.0000',
        uom: 'UN',
        cost: '35.00',
        chargeable_to_customer: false
      },
      completed_at: '2026-05-25T11:30:00Z',
      status: 'REWORK_COMPLETED'
    },
    run_2_passed: {
      test_order_id: 'TST-2026-055-02',
      work_order_id: 'WO-2026-RPR-0055',
      rework_order_id: 'RWK-2026-055-01',
      test_bench_id: 'WC-BPN-TEST',
      equipment_id: 'EQP-BPN-TEST-700',
      tested_by: 'EMP-0701',
      tested_at: '2026-05-26T10:00:00Z',
      target_pressure_bar: '350.0',
      hold_duration_minutes: 30,
      observed_pressure_drop_bar: '0.0',
      cycle_tests: '5 full extension/retraction strokes at 200 bar, zero chatter, smooth stroke',
      outcome: 'PASSED',
      passed_at: '2026-05-26T10:45:00Z'
    }
  },

  final_qc_release: {
    certificate_no: 'QC-REL-RPR-0055',
    work_order_id: 'WO-2026-RPR-0055',
    asset_id: 'AST-CAT-793D-CYL-88412',
    serial_no: '793D-SUSP-B2199',
    inspector_id: 'EMP-0705',
    signed_by: 'EMP-0705',
    release_date: '2026-05-28T14:00:00Z',
    status: 'RELEASED_FOR_RETURN',
    inspections: {
      surface_roughness_ra_um: '0.12 (OEM limit <= 0.20)',
      chrome_thickness_mm: '0.042 (OEM spec >= 0.035)',
      bore_straightness_mm: '0.018',
      hydrostatic_test_result: '350 Bar hold 30 minutes, 0.0 bar drop (Pass)',
      cleanliness_iso_4406: '16/14/11 (Clean oil baseline)'
    }
  },

  return_shipment: {
    id: 'SHP-2026-RPR-001',
    shipment_number: 'SHP-2026-RPR-001',
    plant_id: 'PLANT-BPN',
    customer_party_id: 'PRT-CUST-KPC',
    sales_order_id: 'SO-2026-RPR-0055',
    shipment_mode: 'CUSTOMER_ASSET_RETURN',
    dispatched_at: '2026-05-31T14:30:00Z',
    status: 'DELIVERED',
    carrier: 'PT Mitra Maju Transport',
    consignment_note: 'MMT-BPN-SGT-0841',
    lines: [
      {
        line_no: 1,
        asset_id: 'AST-CAT-793D-CYL-88412',
        serial_no: '793D-SUSP-B2199',
        description: 'Repaired Caterpillar 793D Suspension Cylinder LH',
        shipped_qty: '1.0000',
        uom: 'SET'
      }
    ],
    proof_of_delivery: {
      pod_id: 'POD-2026-RPR-001',
      delivered_at: '2026-06-02T11:00:00Z',
      receiver_name: 'Agus Salim (KPC Central Workshop Receiving)',
      receiver_badge: 'KPC-CW-492',
      status: 'CONFIRMED'
    }
  },

  final_invoice: {
    id: 'INV-2026-RPR-01',
    invoice_number: 'INV-2026-RPR-01',
    legal_entity_id: 'LE-ID-001',
    customer_party_id: 'PRT-CUST-KPC',
    invoice_type: 'REPAIR_FINAL_BILLING',
    issued_date: '2026-06-03T08:30:00Z',
    due_date: '2026-07-03T23:59:59Z',
    currency: 'USD',
    status: 'PAID',
    lines: [
      {
        line_no: 1,
        description: 'Complete overhaul & re-chroming repair of Cat 793D suspension cylinder SN 793D-SUSP-B2199',
        billed_qty: '1.0000',
        uom: 'SET',
        unit_price: '9000.00',
        net_amount: '9000.00',
        tax_rate: '0.11',
        tax_amount: '990.00',
        total_amount: '9990.00',
        source_shipment_id: 'SHP-2026-RPR-001'
      }
    ],
    totals: {
      net_amount: '9000.00',
      tax_amount: '990.00',
      gross_amount: '9990.00',
      deposit_applied: '3000.00',
      cash_paid: '6990.00',
      balance_due: '0.00'
    },
    deposit_application: {
      id: 'DEP-APP-2026-01',
      prepayment_id: 'PRPAY-2026-055',
      invoice_id: 'INV-2026-RPR-01',
      applied_amount: '3000.00',
      applied_at: '2026-06-03T09:00:00Z'
    },
    final_payment: {
      id: 'PAY-2026-RPR-FINAL',
      payment_reference: 'KPC-WIRE-BAL-20260620',
      customer_party_id: 'PRT-CUST-KPC',
      received_at: '2026-06-20T11:15:00Z',
      currency: 'USD',
      amount_received: '6990.00',
      allocations: [
        {
          invoice_id: 'INV-2026-RPR-01',
          amount_applied: '6990.00'
        }
      ]
    }
  },

  warranty: {
    id: 'WAR-2026-055',
    certificate_no: 'WARR-BPN-2026-0055',
    asset_id: 'AST-CAT-793D-CYL-88412',
    serial_no: '793D-SUSP-B2199',
    repair_work_order_id: 'WO-2026-RPR-0055',
    invoice_id: 'INV-2026-RPR-01',
    coverage_term_months: 12,
    coverage_operating_hours: 2500,
    start_date: '2026-06-02T11:00:00Z', // POD delivery date
    expiration_date: '2027-06-02T23:59:59Z',
    status: 'ACTIVE_WARRANTY',
    covered_scope: 'Workmanship, hard-chrome bond adhesion, cylinder hone finish, and Parker seal integrity under standard operating pressure'
  },

  /**
   * Rejection Variant (E02-REJ)
   * Where customer REJECTS Quotation Rev 2:
   * 1. Teardown reveals repair cost/scope exceeds customer threshold.
   * 2. Customer formally rejects Quote Rev 2.
   * 3. Work order cancelled prior to repair release.
   * 4. Diagnostic fee invoice billed per diagnostic authorization (1,200.00 USD net).
   * 5. Diagnostic fee paid in full.
   * 6. Unit returned unrepaired (crated/disassembled) to customer custody.
   */
  rejection_variant: {
    scenario_variant_id: 'E02-REJ',
    description: 'Repair Quote Rejected -> Return Unrepaired with Capped Diagnostic Fee',
    customer_rejection: {
      quotation_id: 'QUO-2026-RPR-0055',
      quotation_revision_id: 'QUO-2026-RPR-0055-R2',
      rejected_at: '2026-05-14T15:00:00Z',
      rejected_by: 'Ir. Bambang Hermanto (KPC Mobile Maintenance Superintendent)',
      rejection_reason: 'Customer decides to retire vehicle fleet section rather than overhaul suspension unit',
      status: 'REJECTED'
    },
    work_order_action: {
      work_order_id: 'WO-2026-RPR-0055-REJ',
      action: 'CANCEL_PRIOR_TO_RELEASE',
      status: 'CANCELLED',
      reason: 'Quotation rejected by customer'
    },
    diagnostic_fee_invoice: {
      id: 'INV-2026-DIAG-0056',
      invoice_number: 'INV-2026-DIAG-0056',
      legal_entity_id: 'LE-ID-001',
      customer_party_id: 'PRT-CUST-KPC',
      invoice_type: 'DIAGNOSTIC_FEE_BILLING',
      issued_date: '2026-05-16T10:00:00Z',
      due_date: '2026-06-15T23:59:59Z',
      currency: 'USD',
      status: 'PAID',
      source_authorization_id: 'DIAG-AUTH-2026-055',
      lines: [
        {
          line_no: 1,
          description: 'Capped diagnostic fee for cylinder teardown, cleaning, and MPI crack inspection (DIAG-AUTH-2026-055)',
          billed_qty: '1.0000',
          uom: 'SET',
          unit_price: '1200.00',
          net_amount: '1200.00',
          tax_rate: '0.11',
          tax_amount: '132.00',
          total_amount: '1332.00'
        }
      ],
      totals: {
        net_amount: '1200.00',
        tax_amount: '132.00',
        gross_amount: '1332.00',
        amount_paid: '1332.00',
        balance_due: '0.00'
      }
    },
    diagnostic_payment: {
      id: 'PAY-2026-DIAG-0056',
      payment_reference: 'KPC-WIRE-DIAG-20260520',
      received_at: '2026-05-20T14:30:00Z',
      currency: 'USD',
      amount_received: '1332.00',
      allocations: [
        {
          invoice_id: 'INV-2026-DIAG-0056',
          amount_applied: '1332.00'
        }
      ]
    },
    return_unrepaired_shipment: {
      id: 'SHP-2026-UNREP-001',
      shipment_number: 'SHP-2026-UNREP-001',
      plant_id: 'PLANT-BPN',
      customer_party_id: 'PRT-CUST-KPC',
      shipment_mode: 'RETURN_UNREPAIRED',
      dispatched_at: '2026-05-22T08:30:00Z',
      status: 'DELIVERED',
      packaging_notes: 'Components cleaned, coated in rust preventative Cosmoline, and boxed in secure wooden transport crate',
      lines: [
        {
          line_no: 1,
          asset_id: 'AST-CAT-793D-CYL-88412',
          serial_no: '793D-SUSP-B2199',
          description: 'Disassembled Cat 793D Suspension Cylinder LH (Returned Unrepaired)',
          shipped_qty: '1.0000',
          uom: 'SET'
        }
      ],
      proof_of_delivery: {
        pod_id: 'POD-2026-UNREP-001',
        delivered_at: '2026-05-24T16:00:00Z',
        receiver_name: 'Agus Salim (KPC Central Workshop Receiving)',
        receiver_badge: 'KPC-CW-492',
        status: 'CONFIRMED'
      },
      final_custody_state: 'RETURNED_UNREPAIRED_TO_CUSTOMER'
    }
  }
};

module.exports = { e02RepairFixture };
