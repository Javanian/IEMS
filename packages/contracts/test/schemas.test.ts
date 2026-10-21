import { test } from 'node:test';
import assert from 'node:assert/strict';
import AjvModule from 'ajv';
import addFormatsModule from 'ajv-formats';

// Support both ESM default and namespace import styles
const Ajv = (AjvModule as any).default || AjvModule;
const addFormats = (addFormatsModule as any).default || addFormatsModule;

import {
  OrganizationSchema,
  LegalEntitySchema,
  PlantSchema,
  UserSchema,
  RoleSchema,
  PermissionSchema,
  UserScopeSchema,
  SessionSchema,
  BadgeSchema,
  EmployeeQualificationSchema
} from '../src/domains/core-iam/schemas.js';

import {
  CustomerSchema,
  InquirySchema,
  InquiryLineSchema,
  QuotationSchema,
  QuoteRevisionSchema,
  QuoteLineSchema,
  EstimateComponentSchema,
  QuoteAcceptanceSchema,
  SalesOrderSchema,
  SalesOrderLineSchema,
  OrderAmendmentSchema,
  BillingEntitlementSchema
} from '../src/domains/commercial/schemas.js';

import {
  DocumentSchema,
  DocumentRevisionSchema,
  BOMRevisionSchema,
  BOMLineSchema,
  RoutingRevisionSchema,
  RoutingOperationSchema,
  CustomerAssetSchema,
  RepairCaseSchema,
  DiagnosticAuthorizationSchema,
  TeardownFindingSchema,
  DispositionSchema,
  ComponentInstallationSchema,
  WarrantyClaimSchema
} from '../src/domains/engineering-repair/schemas.js';

import {
  WorkOrderSchema,
  WorkOperationSchema,
  ExecutionSessionSchema,
  MaterialConsumptionSchema,
  OutputUnitSchema,
  ScrapRecordSchema,
  ReworkOrderSchema
} from '../src/domains/planning-execution/schemas.js';

import {
  StockMovementSchema,
  ReservationSchema,
  ShipmentSchema,
  ShipmentLineSchema,
  FulfillmentAllocationSchema,
  InvoiceSchema,
  InvoiceLineSchema,
  DeliveryBillingAllocationSchema,
  MilestoneBillingAllocationSchema,
  PaymentAllocationSchema,
  DepositApplicationSchema
} from '../src/domains/logistics-billing/schemas.js';

function createValidator() {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv;
}

const ajv = createValidator();

test('Core & IAM Schemas - Valid & Invalid Fixtures', () => {
  // Organization
  const validOrg = {
    id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    code: 'ORG_HOLDING',
    name: 'Industrial Holding Group',
    status: 'ACTIVE',
    createdAt: '2026-10-20T08:00:00Z',
    updatedAt: '2026-10-20T08:00:00Z'
  };
  const validateOrg = ajv.compile(OrganizationSchema);
  assert.strictEqual(validateOrg(validOrg), true, JSON.stringify(validateOrg.errors));
  assert.strictEqual(validateOrg({ ...validOrg, status: 'UNKNOWN_STATUS' }), false);

  // LegalEntity
  const validLegalEntity = {
    id: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
    organizationId: validOrg.id,
    code: 'PT_MFG_INDONESIA',
    name: 'PT Manufaktur Indonesia',
    taxId: '01.234.567.8-901.000',
    baseCurrency: 'IDR',
    status: 'ACTIVE',
    createdAt: '2026-10-20T08:00:00Z',
    updatedAt: '2026-10-20T08:00:00Z'
  };
  const validateLegalEntity = ajv.compile(LegalEntitySchema);
  assert.strictEqual(validateLegalEntity(validLegalEntity), true);

  // Plant
  const validPlant = {
    id: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
    legalEntityId: validLegalEntity.id,
    code: 'PLANT_CIKARANG',
    name: 'Cikarang Heavy Machinery Plant',
    timezone: 'Asia/Jakarta',
    address: 'Kawasan Industri Jababeka Blok A, Cikarang',
    status: 'ACTIVE',
    createdAt: '2026-10-20T08:00:00Z',
    updatedAt: '2026-10-20T08:00:00Z'
  };
  const validatePlant = ajv.compile(PlantSchema);
  assert.strictEqual(validatePlant(validPlant), true);

  // User
  const validUser = {
    id: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44',
    organizationId: validOrg.id,
    username: 'budi.santoso',
    email: 'budi.santoso@iems.internal',
    displayName: 'Budi Santoso',
    status: 'ACTIVE',
    createdAt: '2026-10-20T08:00:00Z',
    updatedAt: '2026-10-20T08:00:00Z'
  };
  const validateUser = ajv.compile(UserSchema);
  assert.strictEqual(validateUser(validUser), true);

  // Role & Permission
  const validRole = {
    id: 'e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55',
    code: 'sales',
    name: 'Commercial Sales Specialist',
    description: 'Responsible for inquiries, quotations and orders',
    isSystemRole: true
  };
  const validateRole = ajv.compile(RoleSchema);
  assert.strictEqual(validateRole(validRole), true);

  const validPerm = {
    id: 'f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a66',
    code: 'commercial:quotation:approve',
    module: 'commercial',
    action: 'approve',
    description: 'Approve quotation revision for sending'
  };
  const validatePerm = ajv.compile(PermissionSchema);
  assert.strictEqual(validatePerm(validPerm), true);

  // Badge & Qualification
  const validBadge = {
    id: 'a1eebc99-9c0b-4ef8-bb6d-6bb9bd380a77',
    employeeId: 'EMP-0042',
    badgeNumber: 'BDG-99881',
    nfcTagId: '04:5A:B2:1F:90:3C:80',
    status: 'ACTIVE',
    issuedAt: '2026-01-01T00:00:00Z',
    expiresAt: '2027-01-01T00:00:00Z'
  };
  const validateBadge = ajv.compile(BadgeSchema);
  assert.strictEqual(validateBadge(validBadge), true);

  const validQual = {
    id: 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a88',
    employeeId: 'EMP-0042',
    skillCode: 'CNC_5AXIS_MILLING',
    certificationLevel: 'LEVEL_3_MASTER',
    evidenceReference: 'CERT-2026-CNC-9981',
    validFrom: '2026-01-01T00:00:00Z',
    validTo: '2027-12-31T23:59:59Z',
    verifiedBy: 'HR_CERT_OFFICER',
    status: 'ACTIVE'
  };
  const validateQual = ajv.compile(EmployeeQualificationSchema);
  assert.strictEqual(validateQual(validQual), true);
});

test('Commercial Domain Schemas - Strict Decimals & Hierarchy', () => {
  // Customer
  const validCust = {
    id: 'c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a99',
    organizationId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    legalEntityId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
    customerCode: 'CUST-PT-TAM',
    name: 'PT Tambang Anugerah Maju',
    taxId: '02.999.888.7-654.000',
    paymentTermsDays: 30,
    currency: 'IDR',
    status: 'ACTIVE',
    billingAddress: 'Gedung Menara Tambang Lt 12, Jakarta Selatan',
    shippingAddress: 'Workshop Site Batu Hijau, Sumbawa',
    createdAt: '2026-10-20T08:00:00Z',
    updatedAt: '2026-10-20T08:00:00Z'
  };
  const validateCust = ajv.compile(CustomerSchema);
  assert.strictEqual(validateCust(validCust), true);

  // Inquiry & InquiryLine
  const validInquiry = {
    id: 'd1eebc99-9c0b-4ef8-bb6d-6bb9bd380b11',
    legalEntityId: validCust.legalEntityId,
    plantId: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
    inquiryNumber: 'INQ-2026-10-001',
    customerId: validCust.id,
    requestedDueDate: '2026-11-15T00:00:00Z',
    status: 'SUBMITTED',
    createdAt: '2026-10-20T08:00:00Z',
    updatedAt: '2026-10-20T08:00:00Z'
  };
  const validateInquiry = ajv.compile(InquirySchema);
  assert.strictEqual(validateInquiry(validInquiry), true);

  const validInquiryLine = {
    id: 'e1eebc99-9c0b-4ef8-bb6d-6bb9bd380b22',
    inquiryId: validInquiry.id,
    lineNumber: 1,
    itemCode: 'CYL-HYD-500MM',
    description: 'Hydraulic Cylinder 500mm Bore Overhaul',
    requestedQuantity: '10',
    requestedUom: 'EA',
    targetPrice: '75000000.00',
    status: 'OPEN'
  };
  const validateInquiryLine = ajv.compile(InquiryLineSchema);
  assert.strictEqual(validateInquiryLine(validInquiryLine), true);
  // Rejection of float quantity
  assert.strictEqual(validateInquiryLine({ ...validInquiryLine, requestedQuantity: 10 as any }), false);

  // Quotation & QuoteRevision
  const validQuote = {
    id: 'f1eebc99-9c0b-4ef8-bb6d-6bb9bd380b33',
    legalEntityId: validCust.legalEntityId,
    plantId: validInquiry.plantId,
    quotationNumber: 'QUO-2026-10-0089',
    customerId: validCust.id,
    inquiryId: validInquiry.id,
    currency: 'IDR',
    status: 'ACTIVE',
    createdAt: '2026-10-20T08:00:00Z',
    updatedAt: '2026-10-20T08:00:00Z'
  };
  const validateQuote = ajv.compile(QuotationSchema);
  assert.strictEqual(validateQuote(validQuote), true);

  const validQuoteRev = {
    id: 'a2eebc99-9c0b-4ef8-bb6d-6bb9bd380b44',
    quotationId: validQuote.id,
    revisionNumber: 1,
    status: 'APPROVED',
    totalMaterialCost: '350000000.00',
    totalLaborCost: '180000000.00',
    totalMachineCost: '95000000.00',
    totalSubcontractCost: '25000000.00',
    totalOverheadCost: '40000000.00',
    subtotal: '690000000.00',
    discountPercent: '5.00',
    discountAmount: '34500000.00',
    totalAmount: '655500000.00',
    currency: 'IDR',
    validityDate: '2026-11-20T23:59:59Z',
    createdAt: '2026-10-20T08:00:00Z',
    updatedAt: '2026-10-20T08:00:00Z'
  };
  const validateQuoteRev = ajv.compile(QuoteRevisionSchema);
  assert.strictEqual(validateQuoteRev(validQuoteRev), true);

  // SalesOrder & Lines
  const validSO = {
    id: 'b2eebc99-9c0b-4ef8-bb6d-6bb9bd380b55',
    legalEntityId: validCust.legalEntityId,
    fulfillmentPlantId: validInquiry.plantId,
    orderNumber: 'SO-2026-10-0042',
    customerId: validCust.id,
    quotationRevisionId: validQuoteRev.id,
    orderMode: 'REPAIR',
    currency: 'IDR',
    subtotal: '655500000.00',
    taxAmount: '72105000.00',
    totalAmount: '727605000.00',
    status: 'CONFIRMED',
    version: 1,
    createdAt: '2026-10-20T08:00:00Z',
    updatedAt: '2026-10-20T08:00:00Z'
  };
  const validateSO = ajv.compile(SalesOrderSchema);
  assert.strictEqual(validateSO(validSO), true);

  // Order amendment (signed decimal delta)
  const validAmendment = {
    id: 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380b66',
    salesOrderId: validSO.id,
    amendmentNumber: 1,
    amendmentReason: 'Additional teardown defect discovered in chrome rod',
    requestedBy: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44',
    priceDelta: '-15000000.00',
    deliveryDateDeltaDays: 5,
    status: 'APPROVED',
    createdAt: '2026-10-20T08:00:00Z'
  };
  const validateAmendment = ajv.compile(OrderAmendmentSchema);
  assert.strictEqual(validateAmendment(validAmendment), true);
});

test('Engineering & Repair Domain Schemas', () => {
  // CustomerAsset & RepairCase
  const validAsset = {
    id: 'd2eebc99-9c0b-4ef8-bb6d-6bb9bd380c11',
    customerId: 'c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a99',
    assetNumber: 'AST-TAM-CYL-09',
    serialNumber: 'SN-KOMATSU-99881',
    modelNumber: 'KOMATSU-PC2000-CYL',
    manufacturer: 'Komatsu Mining Corp',
    description: 'Boom Cylinder LH 3500mm',
    ownershipStatus: 'CUSTOMER_OWNED',
    custodyPlantId: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
    custodyLocation: 'BAY-INTAKE-01',
    conditionNotes: 'Heavy hydraulic fluid leakage, rod scoring evident',
    receivedAt: '2026-10-20T08:00:00Z',
    createdAt: '2026-10-20T08:00:00Z',
    updatedAt: '2026-10-20T08:00:00Z'
  };
  const validateAsset = ajv.compile(CustomerAssetSchema);
  assert.strictEqual(validateAsset(validAsset), true);

  const validRepairCase = {
    id: 'e2eebc99-9c0b-4ef8-bb6d-6bb9bd380c22',
    customerAssetId: validAsset.id,
    legalEntityId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
    plantId: validAsset.custodyPlantId,
    repairCaseNumber: 'RC-2026-10-0012',
    intakeConditionReport: 'Visual inspection shows severe rod galling. Needs authorized teardown.',
    intakePhotosCount: 6,
    status: 'RECEIVED',
    intakeAt: '2026-10-20T08:00:00Z',
    createdAt: '2026-10-20T08:00:00Z',
    updatedAt: '2026-10-20T08:00:00Z'
  };
  const validateRepairCase = ajv.compile(RepairCaseSchema);
  assert.strictEqual(validateRepairCase(validRepairCase), true);

  // Diagnostic Authorization
  const validDiagAuth = {
    id: 'f2eebc99-9c0b-4ef8-bb6d-6bb9bd380c33',
    repairCaseId: validRepairCase.id,
    authorizedScopeDescription: 'Teardown, seal removal and NDT magnetic particle inspection',
    authorizedCostCap: '15000000.00',
    currency: 'IDR',
    approvedByCustomer: 'John Doe (TAM Site Superintendent)',
    approvedAt: '2026-10-20T09:00:00Z',
    authorizedDiagnosticHours: '16.00',
    status: 'APPROVED',
    createdAt: '2026-10-20T09:00:00Z'
  };
  const validateDiagAuth = ajv.compile(DiagnosticAuthorizationSchema);
  assert.strictEqual(validateDiagAuth(validDiagAuth), true);

  // Teardown finding and Disposition
  const validFinding = {
    id: 'a3eebc99-9c0b-4ef8-bb6d-6bb9bd380c44',
    repairCaseId: validRepairCase.id,
    findingNumber: 1,
    componentIdentifier: 'PISTON_ROD_01',
    componentDescription: 'Hard chrome plated piston rod',
    observedDefect: 'Deep score marks 0.8mm depth at mid-stroke',
    failureMode: 'ABRASIVE_CONTAMINATION',
    severity: 'CRITICAL',
    discoveredBy: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44',
    discoveredAt: '2026-10-20T10:00:00Z'
  };
  const validateFinding = ajv.compile(TeardownFindingSchema);
  assert.strictEqual(validateFinding(validFinding), true);

  const validDisposition = {
    id: 'b3eebc99-9c0b-4ef8-bb6d-6bb9bd380c55',
    teardownFindingId: validFinding.id,
    dispositionType: 'REPLACE',
    customerApprovalRequired: true,
    customerApproved: true,
    authorizedCostDelta: '45000000.00',
    technicalJustification: 'Rod scoring exceeds re-chroming maximum allowable tolerance of 0.3mm.',
    createdAt: '2026-10-20T11:00:00Z'
  };
  const validateDisposition = ajv.compile(DispositionSchema);
  assert.strictEqual(validateDisposition(validDisposition), true);
});

test('Planning & Execution Schemas', () => {
  // WorkOrder
  const validWO = {
    id: 'c3eebc99-9c0b-4ef8-bb6d-6bb9bd380d11',
    legalEntityId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
    plantId: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
    workOrderNumber: 'WO-2026-10-0992',
    itemCode: 'CYL-REPAIR-PC2000',
    orderMode: 'REPAIR',
    plannedQuantity: '1',
    uom: 'EA',
    completedQuantity: '0',
    scrappedQuantity: '0',
    reworkQuantity: '0',
    scheduledStartDate: '2026-10-21T07:00:00Z',
    scheduledEndDate: '2026-10-25T16:00:00Z',
    status: 'RELEASED',
    version: 1,
    createdAt: '2026-10-20T08:00:00Z',
    updatedAt: '2026-10-20T08:00:00Z'
  };
  const validateWO = ajv.compile(WorkOrderSchema);
  assert.strictEqual(validateWO(validWO), true);

  // ExecutionSession
  const validSession = {
    id: 'd3eebc99-9c0b-4ef8-bb6d-6bb9bd380d22',
    workOperationId: 'e3eebc99-9c0b-4ef8-bb6d-6bb9bd380d33',
    employeeId: 'EMP-0042',
    badgeId: 'BDG-99881',
    machineCode: 'LATHE-TOS-01',
    sessionType: 'RUN',
    startTime: '2026-10-21T08:00:00Z',
    endTime: '2026-10-21T12:00:00Z',
    durationMinutes: '240.00',
    status: 'CLOSED'
  };
  const validateSession = ajv.compile(ExecutionSessionSchema);
  assert.strictEqual(validateSession(validSession), true);

  // OutputUnit
  const validOutput = {
    id: 'f3eebc99-9c0b-4ef8-bb6d-6bb9bd380d44',
    workOrderId: validWO.id,
    workOperationId: validSession.workOperationId,
    serialNumber: 'SN-REPAIRED-2026-001',
    quantityProduced: '1',
    uom: 'EA',
    qualityStatus: 'ACCEPTED',
    producedAt: '2026-10-21T16:00:00Z',
    employeeId: 'EMP-0042'
  };
  const validateOutput = ajv.compile(OutputUnitSchema);
  assert.strictEqual(validateOutput(validOutput), true);
});

test('Logistics & Billing Domain Schemas', () => {
  // StockMovement
  const validMovement = {
    id: 'a4eebc99-9c0b-4ef8-bb6d-6bb9bd380e11',
    plantId: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
    movementNumber: 'MVT-2026-10-0044',
    movementType: 'GOODS_ISSUE',
    sourceLocation: 'WH-CENTRAL-A1',
    destinationLocation: 'WIP-SHOP-FLOOR',
    inventoryOwnerId: 'COMPANY',
    referenceDocumentType: 'WORK_ORDER',
    referenceDocumentId: 'WO-2026-10-0992',
    postedAt: '2026-10-21T08:15:00Z',
    postedBy: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44',
    isReversed: false
  };
  const validateMovement = ajv.compile(StockMovementSchema);
  assert.strictEqual(validateMovement(validMovement), true);

  // Invoice & Allocations
  const validInvoice = {
    id: 'b4eebc99-9c0b-4ef8-bb6d-6bb9bd380e22',
    legalEntityId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
    billingPlantId: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
    invoiceNumber: 'INV-2026-10-0021',
    customerId: 'c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a99',
    invoiceType: 'COMMERCIAL_DELIVERY',
    invoiceDate: '2026-10-22T00:00:00Z',
    dueDate: '2026-11-21T00:00:00Z',
    currency: 'IDR',
    subtotal: '655500000.00',
    taxAmount: '72105000.00',
    totalAmount: '727605000.00',
    paidAmount: '0.00',
    balanceDue: '727605000.00',
    status: 'POSTED',
    version: 1,
    createdAt: '2026-10-22T08:00:00Z',
    updatedAt: '2026-10-22T08:00:00Z'
  };
  const validateInvoice = ajv.compile(InvoiceSchema);
  assert.strictEqual(validateInvoice(validInvoice), true);

  // Deposit application
  const validDeposit = {
    id: 'c4eebc99-9c0b-4ef8-bb6d-6bb9bd380e33',
    finalInvoiceId: validInvoice.id,
    depositInvoiceId: 'd4eebc99-9c0b-4ef8-bb6d-6bb9bd380e44',
    prepaymentReference: 'DEP-TAM-2026-001',
    appliedDepositAmount: '200000000.00',
    currency: 'IDR',
    appliedAt: '2026-10-22T09:00:00Z',
    approvedBy: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44'
  };
  const validateDeposit = ajv.compile(DepositApplicationSchema);
  assert.strictEqual(validateDeposit(validDeposit), true);
});

test('All 50 domain entity schemas compile without errors in Ajv', () => {
  const allSchemas = [
    OrganizationSchema,
    LegalEntitySchema,
    PlantSchema,
    UserSchema,
    RoleSchema,
    PermissionSchema,
    UserScopeSchema,
    SessionSchema,
    BadgeSchema,
    EmployeeQualificationSchema,
    CustomerSchema,
    InquirySchema,
    InquiryLineSchema,
    QuotationSchema,
    QuoteRevisionSchema,
    QuoteLineSchema,
    EstimateComponentSchema,
    QuoteAcceptanceSchema,
    SalesOrderSchema,
    SalesOrderLineSchema,
    OrderAmendmentSchema,
    BillingEntitlementSchema,
    DocumentSchema,
    DocumentRevisionSchema,
    BOMRevisionSchema,
    BOMLineSchema,
    RoutingRevisionSchema,
    RoutingOperationSchema,
    CustomerAssetSchema,
    RepairCaseSchema,
    DiagnosticAuthorizationSchema,
    TeardownFindingSchema,
    DispositionSchema,
    ComponentInstallationSchema,
    WarrantyClaimSchema,
    WorkOrderSchema,
    WorkOperationSchema,
    ExecutionSessionSchema,
    MaterialConsumptionSchema,
    OutputUnitSchema,
    ScrapRecordSchema,
    ReworkOrderSchema,
    StockMovementSchema,
    ReservationSchema,
    ShipmentSchema,
    ShipmentLineSchema,
    FulfillmentAllocationSchema,
    InvoiceSchema,
    InvoiceLineSchema,
    DeliveryBillingAllocationSchema,
    MilestoneBillingAllocationSchema,
    PaymentAllocationSchema,
    DepositApplicationSchema
  ];

  for (const schema of allSchemas) {
    const validator = ajv.compile(schema);
    assert.strictEqual(typeof validator, 'function', `Schema ${schema.$id} failed to compile`);
  }
});
