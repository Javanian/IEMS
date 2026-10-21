/**
 * Scenario E01: Manufacturing 10 Units End-to-End
 * Complete, deterministic domain test fixture.
 *
 * Sequence:
 * 1. Customer Inquiry (INQ-2026-03-0012)
 * 2. Quotation Rev 1 (QUO-2026-0412-R1) -> preliminary estimate 12,800 USD/unit
 * 3. Quotation Rev 2 (QUO-2026-0412-R2) -> negotiated 12,250 USD/unit (Rev 1 SUPERSEDED)
 * 4. Customer Acceptance (ACC-2026-0412)
 * 5. Sales Order (SO-2026-0881) with Billing Entitlement
 * 6. Engineering Work Package (PKG-SLP-250-R2) with BOM Rev B and Routing Rev B
 * 7. Demand Pegging & 2 Work Orders: WO-2026-MFG-001 (6 units) and WO-2026-MFG-002 (4 units)
 * 8. Procurement & Inbound Goods Receipt (PO-2026-PRC-0914, GR-2026-0520) with QA release
 * 9. Material Issue to WO 1 and WO 2
 * 10. Execution Sessions (Labor and Machine)
 * 11. Production Outputs & Serial Numbers (SN-2026-SLP-001 to SN-2026-SLP-010)
 * 12. QC Inspection Release (QC-REL-001 for 6 units, QC-REL-002 for 4 units)
 * 13. Partial Shipment 1 (6 units) & Delivery Proof (POD-2026-0041)
 * 14. Delivery Invoice 1 (6 units = 73,500.00 USD net + 8,085.00 USD VAT)
 * 15. Partial Shipment 2 (4 units) & Delivery Proof (POD-2026-0042)
 * 16. Delivery Invoice 2 (4 units = 49,000.00 USD net + 5,390.00 USD VAT)
 * 17. Payment Allocations (PAY-2026-0301 settling INV 1, PAY-2026-0342 settling INV 2)
 */

'use strict';

const e01ManufacturingFixture = {
  scenario_id: 'E01',
  scenario_name: 'Manufacturing 10 Units End-to-End with Partial Work Orders, Shipments, and Invoices',
  legal_entity_id: 'LE-ID-001',
  plant_id: 'PLANT-CKR',
  customer_party_id: 'PRT-CUST-NMR',
  item_code: 'ASY-SLP-250-HC',

  inquiry: {
    id: 'INQ-2026-03-0012',
    plant_id: 'PLANT-CKR',
    customer_party_id: 'PRT-CUST-NMR',
    inquiry_number: 'INQ-2026-03-0012',
    inquiry_date: '2026-03-10T08:15:00Z',
    status: 'CONVERTED_TO_QUOTATION',
    contact_person: 'Ir. Hendro Prasetyo (Procurement Lead)',
    lines: [
      {
        line_no: 1,
        item_code: 'ASY-SLP-250-HC',
        description: 'Slurry Pump Impeller Shaft Assembly 250mm High-Chrome Alloy',
        requested_qty: '10.0000',
        uom: 'UN',
        target_delivery_date: '2026-05-30',
        drawing_reference: 'DWG-SLP-250-REV-C'
      }
    ]
  },

  quotation: {
    id: 'QUO-2026-0412',
    quotation_number: 'QUO-2026-0412',
    legal_entity_id: 'LE-ID-001',
    plant_id: 'PLANT-CKR',
    customer_party_id: 'PRT-CUST-NMR',
    inquiry_id: 'INQ-2026-03-0012',
    currency: 'USD',

    revisions: [
      {
        id: 'QUO-2026-0412-R1',
        revision_no: 1,
        status: 'SUPERSEDED',
        issued_date: '2026-03-15T10:00:00Z',
        expiry_date: '2026-04-14T23:59:59Z',
        lead_time_days: 60,
        superseded_by_revision_no: 2,
        superseded_reason: 'Customer negotiated volume discount and 45-day lead time',
        lines: [
          {
            line_no: 1,
            item_code: 'ASY-SLP-250-HC',
            quoted_qty: '10.0000',
            uom: 'UN',
            unit_price: '12800.00',
            net_amount: '128000.00',
            tax_rate: '0.11',
            tax_amount: '14080.00',
            total_amount: '142080.00'
          }
        ]
      },
      {
        id: 'QUO-2026-0412-R2',
        revision_no: 2,
        status: 'ACCEPTED',
        issued_date: '2026-04-02T09:30:00Z',
        expiry_date: '2026-05-02T23:59:59Z',
        lead_time_days: 45,
        superseded_by_revision_no: null,
        superseded_reason: null,
        lines: [
          {
            line_no: 1,
            item_code: 'ASY-SLP-250-HC',
            quoted_qty: '10.0000',
            uom: 'UN',
            unit_price: '12250.00',
            net_amount: '122500.00',
            tax_rate: '0.11',
            tax_amount: '13475.00',
            total_amount: '135975.00'
          }
        ]
      }
    ]
  },

  quote_acceptance: {
    id: 'ACC-2026-0412',
    quotation_id: 'QUO-2026-0412',
    quotation_revision_id: 'QUO-2026-0412-R2',
    quote_line_no: 1,
    accepted_at: '2026-04-12T14:30:00Z',
    accepted_by: 'Ir. Hendro Prasetyo (Customer PO Ref NMR-PO-2026-081)',
    accepted_qty: '10.0000',
    uom: 'UN',
    accepted_unit_price: '12250.00',
    accepted_net_amount: '122500.00',
    tax_rate: '0.11',
    accepted_tax_amount: '13475.00',
    accepted_total_amount: '135975.00'
  },

  sales_order: {
    id: 'SO-2026-0881',
    order_number: 'SO-2026-0881',
    legal_entity_id: 'LE-ID-001',
    plant_id: 'PLANT-CKR',
    customer_party_id: 'PRT-CUST-NMR',
    customer_po_number: 'NMR-PO-2026-081',
    order_date: '2026-04-14T11:00:00Z',
    currency: 'USD',
    order_type: 'MANUFACTURING',
    status: 'FULFILLED',
    lines: [
      {
        line_no: 1,
        item_id: 'ITM-ASY-SLP-250',
        item_code: 'ASY-SLP-250-HC',
        description: 'Slurry Pump Impeller Shaft Assembly 250mm High-Chrome Alloy',
        ordered_qty: '10.0000',
        uom: 'UN',
        unit_price: '12250.00',
        net_amount: '122500.00',
        tax_rate: '0.11',
        tax_amount: '13475.00',
        total_amount: '135975.00',
        quote_acceptance_id: 'ACC-2026-0412',
        fulfillment_plant_id: 'PLANT-CKR',
        promised_delivery_date: '2026-05-30',
        shipped_qty: '10.0000',
        billed_qty: '10.0000',
        status: 'FULFILLED'
      }
    ]
  },

  billing_entitlement: {
    id: 'ENT-SO-0881-01',
    sales_order_id: 'SO-2026-0881',
    sales_order_line_no: 1,
    authorized_net_cap: '122500.00',
    currency: 'USD',
    delivery_billed_net: '122500.00',
    milestone_billed_net: '0.00',
    remaining_billable_net: '0.00',
    status: 'FULLY_BILLED'
  },

  engineering_package: {
    id: 'PKG-SLP-250-R2',
    package_code: 'ENG-PKG-SLP-250',
    revision_code: 'REV-B',
    item_code: 'ASY-SLP-250-HC',
    status: 'RELEASED_FOR_PRODUCTION',
    approved_by: 'EMP-0205',
    approved_at: '2026-04-15T09:00:00Z',

    bom: {
      revision_code: 'BOM-SLP-250-B',
      effective_start: '2026-04-15',
      components: [
        { line_no: 1, item_code: 'CST-HC-250', qty_per_parent: '1.0000', uom: 'UN', scrap_factor: '0.0000' },
        { line_no: 2, item_code: 'SFT-4140-100', qty_per_parent: '1.0000', uom: 'UN', scrap_factor: '0.0000' },
        { line_no: 3, item_code: 'SEL-VTN-100', qty_per_parent: '1.0000', uom: 'UN', scrap_factor: '0.0000' },
        { line_no: 4, item_code: 'BRG-SKF-22220', qty_per_parent: '2.0000', uom: 'UN', scrap_factor: '0.0000' },
        { line_no: 5, item_code: 'FST-KIT-M24', qty_per_parent: '1.0000', uom: 'SET', scrap_factor: '0.0000' }
      ]
    },

    routing: {
      revision_code: 'RTG-SLP-250-B',
      operations: [
        {
          operation_no: 10,
          operation_name: 'CNC Turning & Boring Impeller Hub',
          workcenter_id: 'WC-CNC-01',
          required_skill: 'SKILL-CNC-3AXIS',
          setup_hours: '1.5000',
          run_hours_per_unit: '2.5000'
        },
        {
          operation_no: 20,
          operation_name: 'Drive Shaft Milling & Precision Keyway Broaching',
          workcenter_id: 'WC-MILL-02',
          required_skill: 'SKILL-CNC-3AXIS',
          setup_hours: '1.0000',
          run_hours_per_unit: '1.8000'
        },
        {
          operation_no: 30,
          operation_name: 'Dynamic Balancing to ISO 1940-1 Grade G2.5',
          workcenter_id: 'WC-BAL-01',
          required_skill: 'SKILL-PRECISION-BALANCING',
          setup_hours: '0.5000',
          run_hours_per_unit: '1.0000'
        },
        {
          operation_no: 40,
          operation_name: 'Cleanroom Cartridge Seal and Bearing Assembly',
          workcenter_id: 'WC-ASM-01',
          required_skill: 'SKILL-HYD-ASSEMBLY',
          setup_hours: '0.5000',
          run_hours_per_unit: '2.0000'
        },
        {
          operation_no: 50,
          operation_name: 'Final Hydrostatic Pressure & Runout Verification',
          workcenter_id: 'WC-TST-01',
          required_skill: 'SKILL-HYDRO-TEST-SIGNOFF',
          setup_hours: '0.5000',
          run_hours_per_unit: '1.2000'
        }
      ]
    }
  },

  work_orders: [
    {
      id: 'WO-2026-MFG-001',
      order_number: 'WO-2026-MFG-001',
      plant_id: 'PLANT-CKR',
      item_code: 'ASY-SLP-250-HC',
      target_qty: '6.0000',
      uom: 'UN',
      engineering_package_id: 'PKG-SLP-250-R2',
      status: 'COMPLETED',
      planned_start: '2026-04-18T08:00:00Z',
      actual_completion: '2026-05-02T16:00:00Z',
      demand_allocation: {
        sales_order_id: 'SO-2026-0881',
        sales_order_line_no: 1,
        allocated_qty: '6.0000',
        uom: 'UN'
      },
      material_requirements: [
        { item_code: 'CST-HC-250', required_qty: '6.0000', issued_qty: '6.0000', uom: 'UN' },
        { item_code: 'SFT-4140-100', required_qty: '6.0000', issued_qty: '6.0000', uom: 'UN' },
        { item_code: 'SEL-VTN-100', required_qty: '6.0000', issued_qty: '6.0000', uom: 'UN' },
        { item_code: 'BRG-SKF-22220', required_qty: '12.0000', issued_qty: '12.0000', uom: 'UN' },
        { item_code: 'FST-KIT-M24', required_qty: '6.0000', issued_qty: '6.0000', uom: 'SET' }
      ],
      produced_serials: [
        'SN-2026-SLP-001',
        'SN-2026-SLP-002',
        'SN-2026-SLP-003',
        'SN-2026-SLP-004',
        'SN-2026-SLP-005',
        'SN-2026-SLP-006'
      ]
    },
    {
      id: 'WO-2026-MFG-002',
      order_number: 'WO-2026-MFG-002',
      plant_id: 'PLANT-CKR',
      item_code: 'ASY-SLP-250-HC',
      target_qty: '4.0000',
      uom: 'UN',
      engineering_package_id: 'PKG-SLP-250-R2',
      status: 'COMPLETED',
      planned_start: '2026-04-25T08:00:00Z',
      actual_completion: '2026-05-10T15:30:00Z',
      demand_allocation: {
        sales_order_id: 'SO-2026-0881',
        sales_order_line_no: 1,
        allocated_qty: '4.0000',
        uom: 'UN'
      },
      material_requirements: [
        { item_code: 'CST-HC-250', required_qty: '4.0000', issued_qty: '4.0000', uom: 'UN' },
        { item_code: 'SFT-4140-100', required_qty: '4.0000', issued_qty: '4.0000', uom: 'UN' },
        { item_code: 'SEL-VTN-100', required_qty: '4.0000', issued_qty: '4.0000', uom: 'UN' },
        { item_code: 'BRG-SKF-22220', required_qty: '8.0000', issued_qty: '8.0000', uom: 'UN' },
        { item_code: 'FST-KIT-M24', required_qty: '4.0000', issued_qty: '4.0000', uom: 'SET' }
      ],
      produced_serials: [
        'SN-2026-SLP-007',
        'SN-2026-SLP-008',
        'SN-2026-SLP-009',
        'SN-2026-SLP-010'
      ]
    }
  ],

  procurement: {
    purchase_order: {
      id: 'PO-2026-PRC-0914',
      po_number: 'PO-2026-PRC-0914',
      supplier_party_id: 'PRT-SUP-ICP',
      plant_id: 'PLANT-CKR',
      po_date: '2026-04-14T15:00:00Z',
      status: 'FULFILLED',
      lines: [
        { line_no: 1, item_code: 'CST-HC-250', ordered_qty: '10.0000', uom: 'UN', unit_price: '2400.00', net_amount: '24000.00' },
        { line_no: 2, item_code: 'SFT-4140-100', ordered_qty: '10.0000', uom: 'UN', unit_price: '850.00', net_amount: '8500.00' },
        { line_no: 3, item_code: 'SEL-VTN-100', ordered_qty: '10.0000', uom: 'UN', unit_price: '950.00', net_amount: '9500.00' },
        { line_no: 4, item_code: 'BRG-SKF-22220', ordered_qty: '20.0000', uom: 'UN', unit_price: '380.00', net_amount: '7600.00' },
        { line_no: 5, item_code: 'FST-KIT-M24', ordered_qty: '10.0000', uom: 'SET', unit_price: '110.00', net_amount: '1100.00' }
      ]
    },
    goods_receipt: {
      id: 'GR-2026-0520',
      gr_number: 'GR-2026-0520',
      po_id: 'PO-2026-PRC-0914',
      warehouse_id: 'WH-RAW-CKR',
      received_at: '2026-04-17T09:45:00Z',
      status: 'QC_RELEASED',
      lines: [
        { line_no: 1, item_code: 'CST-HC-250', received_qty: '10.0000', uom: 'UN', lot_number: 'LOT-2026-CST-088', heat_number: 'H-7741' },
        { line_no: 2, item_code: 'SFT-4140-100', received_qty: '10.0000', uom: 'UN', lot_number: 'LOT-2026-SFT-092', heat_number: 'H-8902' },
        { line_no: 3, item_code: 'SEL-VTN-100', received_qty: '10.0000', uom: 'UN', lot_number: 'LOT-2026-SEL-110', heat_number: 'BATCH-26B' },
        { line_no: 4, item_code: 'BRG-SKF-22220', received_qty: '20.0000', uom: 'UN', lot_number: 'LOT-2026-BRG-204', heat_number: 'MFR-2026' },
        { line_no: 5, item_code: 'FST-KIT-M24', received_qty: '10.0000', uom: 'SET', lot_number: 'LOT-2026-FST-301', heat_number: 'LOT-F301' }
      ]
    }
  },

  material_issues: [
    {
      movement_id: 'MOV-ISS-WO001',
      work_order_id: 'WO-2026-MFG-001',
      movement_type: 'WORK_ORDER_ISSUE',
      posted_at: '2026-04-18T08:30:00Z',
      source_warehouse_id: 'WH-RAW-CKR',
      lines: [
        { item_code: 'CST-HC-250', lot_number: 'LOT-2026-CST-088', qty: '6.0000', uom: 'UN' },
        { item_code: 'SFT-4140-100', lot_number: 'LOT-2026-SFT-092', qty: '6.0000', uom: 'UN' },
        { item_code: 'SEL-VTN-100', lot_number: 'LOT-2026-SEL-110', qty: '6.0000', uom: 'UN' },
        { item_code: 'BRG-SKF-22220', lot_number: 'LOT-2026-BRG-204', qty: '12.0000', uom: 'UN' },
        { item_code: 'FST-KIT-M24', lot_number: 'LOT-2026-FST-301', qty: '6.0000', uom: 'SET' }
      ]
    },
    {
      movement_id: 'MOV-ISS-WO002',
      work_order_id: 'WO-2026-MFG-002',
      movement_type: 'WORK_ORDER_ISSUE',
      posted_at: '2026-04-25T08:30:00Z',
      source_warehouse_id: 'WH-RAW-CKR',
      lines: [
        { item_code: 'CST-HC-250', lot_number: 'LOT-2026-CST-088', qty: '4.0000', uom: 'UN' },
        { item_code: 'SFT-4140-100', lot_number: 'LOT-2026-SFT-092', qty: '4.0000', uom: 'UN' },
        { item_code: 'SEL-VTN-100', lot_number: 'LOT-2026-SEL-110', qty: '4.0000', uom: 'UN' },
        { item_code: 'BRG-SKF-22220', lot_number: 'LOT-2026-BRG-204', qty: '8.0000', uom: 'UN' },
        { item_code: 'FST-KIT-M24', lot_number: 'LOT-2026-FST-301', qty: '4.0000', uom: 'SET' }
      ]
    }
  ],

  execution_sessions: [
    {
      work_order_id: 'WO-2026-MFG-001',
      operation_no: 10,
      workcenter_id: 'WC-CNC-01',
      employee_id: 'EMP-0104',
      badge_no: 'BDG-0104',
      start_time: '2026-04-18T09:00:00Z',
      end_time: '2026-04-19T17:30:00Z',
      run_hours: '15.0000',
      produced_qty: '6.0000',
      scrap_qty: '0.0000'
    },
    {
      work_order_id: 'WO-2026-MFG-001',
      operation_no: 40,
      workcenter_id: 'WC-ASM-01',
      employee_id: 'EMP-0108',
      badge_no: 'BDG-0108',
      start_time: '2026-04-28T08:30:00Z',
      end_time: '2026-04-29T16:30:00Z',
      run_hours: '12.0000',
      produced_qty: '6.0000',
      scrap_qty: '0.0000'
    },
    {
      work_order_id: 'WO-2026-MFG-002',
      operation_no: 10,
      workcenter_id: 'WC-CNC-01',
      employee_id: 'EMP-0104',
      badge_no: 'BDG-0104',
      start_time: '2026-04-25T09:00:00Z',
      end_time: '2026-04-26T15:00:00Z',
      run_hours: '10.0000',
      produced_qty: '4.0000',
      scrap_qty: '0.0000'
    },
    {
      work_order_id: 'WO-2026-MFG-002',
      operation_no: 40,
      workcenter_id: 'WC-ASM-01',
      employee_id: 'EMP-0108',
      badge_no: 'BDG-0108',
      start_time: '2026-05-04T08:30:00Z',
      end_time: '2026-05-05T14:30:00Z',
      run_hours: '8.0000',
      produced_qty: '4.0000',
      scrap_qty: '0.0000'
    }
  ],

  quality_releases: [
    {
      certificate_no: 'QC-REL-001',
      inspection_order_id: 'INSP-2026-0811',
      work_order_id: 'WO-2026-MFG-001',
      inspected_qty: '6.0000',
      accepted_qty: '6.0000',
      rejected_qty: '0.0000',
      inspector_id: 'EMP-0201',
      signed_by: 'EMP-0205',
      release_date: '2026-05-03T10:00:00Z',
      serials_released: [
        'SN-2026-SLP-001',
        'SN-2026-SLP-002',
        'SN-2026-SLP-003',
        'SN-2026-SLP-004',
        'SN-2026-SLP-005',
        'SN-2026-SLP-006'
      ],
      verifications: {
        dimensional_bore_mm: '100.012',
        runout_tir_mm: '0.014',
        dynamic_balance_rms: '1.24 mm/s (ISO G2.5 Pass)',
        hydrostatic_hold_bar: '25.0 bar for 30 min (0.0 bar drop)'
      }
    },
    {
      certificate_no: 'QC-REL-002',
      inspection_order_id: 'INSP-2026-0812',
      work_order_id: 'WO-2026-MFG-002',
      inspected_qty: '4.0000',
      accepted_qty: '4.0000',
      rejected_qty: '0.0000',
      inspector_id: 'EMP-0201',
      signed_by: 'EMP-0205',
      release_date: '2026-05-11T11:00:00Z',
      serials_released: [
        'SN-2026-SLP-007',
        'SN-2026-SLP-008',
        'SN-2026-SLP-009',
        'SN-2026-SLP-010'
      ],
      verifications: {
        dimensional_bore_mm: '100.015',
        runout_tir_mm: '0.015',
        dynamic_balance_rms: '1.30 mm/s (ISO G2.5 Pass)',
        hydrostatic_hold_bar: '25.0 bar for 30 min (0.0 bar drop)'
      }
    }
  ],

  shipments: [
    {
      id: 'SHP-2026-0041',
      shipment_number: 'SHP-2026-0041',
      plant_id: 'PLANT-CKR',
      customer_party_id: 'PRT-CUST-NMR',
      sales_order_id: 'SO-2026-0881',
      sales_order_line_no: 1,
      shipment_mode: 'MANUFACTURED_DELIVERY',
      dispatched_at: '2026-05-04T07:00:00Z',
      status: 'DELIVERED',
      transporter: 'PT Samudera Logistik Indonesia',
      consignment_note: 'SLI-BPN-99201',
      lines: [
        {
          line_no: 1,
          item_code: 'ASY-SLP-250-HC',
          shipped_qty: '6.0000',
          uom: 'UN',
          serials: [
            'SN-2026-SLP-001',
            'SN-2026-SLP-002',
            'SN-2026-SLP-003',
            'SN-2026-SLP-004',
            'SN-2026-SLP-005',
            'SN-2026-SLP-006'
          ]
        }
      ],
      fulfillment_allocation: {
        sales_order_id: 'SO-2026-0881',
        sales_order_line_no: 1,
        allocated_qty: '6.0000',
        uom: 'UN'
      },
      proof_of_delivery: {
        pod_id: 'POD-2026-0041',
        delivered_at: '2026-05-08T14:20:00Z',
        receiver_name: 'Budi Santoso (Warehouse Supervisor Sangatta)',
        receiver_badge: 'NMR-WH-884',
        status: 'SIGNED_AND_CONFIRMED'
      }
    },
    {
      id: 'SHP-2026-0042',
      shipment_number: 'SHP-2026-0042',
      plant_id: 'PLANT-CKR',
      customer_party_id: 'PRT-CUST-NMR',
      sales_order_id: 'SO-2026-0881',
      sales_order_line_no: 1,
      shipment_mode: 'MANUFACTURED_DELIVERY',
      dispatched_at: '2026-05-12T07:30:00Z',
      status: 'DELIVERED',
      transporter: 'PT Samudera Logistik Indonesia',
      consignment_note: 'SLI-BPN-99285',
      lines: [
        {
          line_no: 1,
          item_code: 'ASY-SLP-250-HC',
          shipped_qty: '4.0000',
          uom: 'UN',
          serials: [
            'SN-2026-SLP-007',
            'SN-2026-SLP-008',
            'SN-2026-SLP-009',
            'SN-2026-SLP-010'
          ]
        }
      ],
      fulfillment_allocation: {
        sales_order_id: 'SO-2026-0881',
        sales_order_line_no: 1,
        allocated_qty: '4.0000',
        uom: 'UN'
      },
      proof_of_delivery: {
        pod_id: 'POD-2026-0042',
        delivered_at: '2026-05-16T10:15:00Z',
        receiver_name: 'Budi Santoso (Warehouse Supervisor Sangatta)',
        receiver_badge: 'NMR-WH-884',
        status: 'SIGNED_AND_CONFIRMED'
      }
    }
  ],

  invoices: [
    {
      id: 'INV-2026-0104',
      invoice_number: 'INV-2026-0104',
      legal_entity_id: 'LE-ID-001',
      customer_party_id: 'PRT-CUST-NMR',
      invoice_type: 'DELIVERY_BASED',
      issued_date: '2026-05-09T08:00:00Z',
      due_date: '2026-06-08T23:59:59Z',
      currency: 'USD',
      status: 'PAID',
      lines: [
        {
          line_no: 1,
          item_code: 'ASY-SLP-250-HC',
          description: 'Partial Shipment 1 of 2: Slurry Pump Impeller Shaft Assembly 250mm High-Chrome Alloy (6 Units)',
          billed_qty: '6.0000',
          uom: 'UN',
          unit_price: '12250.00',
          net_amount: '73500.00',
          tax_rate: '0.11',
          tax_amount: '8085.00',
          total_amount: '81585.00',
          source_shipment_id: 'SHP-2026-0041',
          source_shipment_line_no: 1
        }
      ],
      totals: {
        net_amount: '73500.00',
        tax_amount: '8085.00',
        gross_amount: '81585.00',
        amount_paid: '81585.00',
        balance_due: '0.00'
      },
      billing_allocation: {
        entitlement_id: 'ENT-SO-0881-01',
        sales_order_id: 'SO-2026-0881',
        sales_order_line_no: 1,
        allocated_net_amount: '73500.00'
      }
    },
    {
      id: 'INV-2026-0118',
      invoice_number: 'INV-2026-0118',
      legal_entity_id: 'LE-ID-001',
      customer_party_id: 'PRT-CUST-NMR',
      invoice_type: 'DELIVERY_BASED',
      issued_date: '2026-05-17T08:00:00Z',
      due_date: '2026-06-16T23:59:59Z',
      currency: 'USD',
      status: 'PAID',
      lines: [
        {
          line_no: 1,
          item_code: 'ASY-SLP-250-HC',
          description: 'Final Shipment 2 of 2: Slurry Pump Impeller Shaft Assembly 250mm High-Chrome Alloy (4 Units)',
          billed_qty: '4.0000',
          uom: 'UN',
          unit_price: '12250.00',
          net_amount: '49000.00',
          tax_rate: '0.11',
          tax_amount: '5390.00',
          total_amount: '54390.00',
          source_shipment_id: 'SHP-2026-0042',
          source_shipment_line_no: 1
        }
      ],
      totals: {
        net_amount: '49000.00',
        tax_amount: '5390.00',
        gross_amount: '54390.00',
        amount_paid: '54390.00',
        balance_due: '0.00'
      },
      billing_allocation: {
        entitlement_id: 'ENT-SO-0881-01',
        sales_order_id: 'SO-2026-0881',
        sales_order_line_no: 1,
        allocated_net_amount: '49000.00'
      }
    }
  ],

  payments: [
    {
      id: 'PAY-2026-0301',
      payment_reference: 'NMR-WIRE-20260528-01',
      customer_party_id: 'PRT-CUST-NMR',
      received_at: '2026-05-28T11:45:00Z',
      currency: 'USD',
      amount_received: '81585.00',
      bank_account: 'Bank Mandiri USD 122-00-1092881-9',
      allocations: [
        {
          invoice_id: 'INV-2026-0104',
          invoice_number: 'INV-2026-0104',
          amount_applied: '81585.00',
          applied_at: '2026-05-28T14:00:00Z'
        }
      ]
    },
    {
      id: 'PAY-2026-0342',
      payment_reference: 'NMR-WIRE-20260605-02',
      customer_party_id: 'PRT-CUST-NMR',
      received_at: '2026-06-05T09:20:00Z',
      currency: 'USD',
      amount_received: '54390.00',
      bank_account: 'Bank Mandiri USD 122-00-1092881-9',
      allocations: [
        {
          invoice_id: 'INV-2026-0118',
          invoice_number: 'INV-2026-0118',
          amount_applied: '54390.00',
          applied_at: '2026-06-05T10:30:00Z'
        }
      ]
    }
  ],

  reconciliation_summary: {
    ordered_qty: '10.0000',
    work_orders_planned_qty: '10.0000',
    work_orders_completed_qty: '10.0000',
    qc_released_qty: '10.0000',
    shipped_qty: '10.0000',
    pod_confirmed_qty: '10.0000',
    billed_qty: '10.0000',
    total_order_net: '122500.00',
    total_order_tax: '13475.00',
    total_order_gross: '135975.00',
    total_billed_net: '122500.00',
    total_billed_tax: '13475.00',
    total_billed_gross: '135975.00',
    total_payments_collected: '135975.00',
    outstanding_balance: '0.00'
  }
};

module.exports = { e01ManufacturingFixture };
