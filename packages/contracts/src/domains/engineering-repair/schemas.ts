/**
 * Engineering & Repair Domain JSON Schemas
 */

import { ISO_CURRENCIES, STANDARD_UOMS } from '../../common/decimal.js';

const decimalPattern = '^[0-9]+(\\.[0-9]+)?$';
const signedDecimalPattern = '^-?[0-9]+(\\.[0-9]+)?$';

export const DocumentSchema = {
  $id: 'https://iems.org/schemas/engineering-repair/document.json',
  type: 'object',
  required: ['id', 'legalEntityId', 'plantId', 'documentNumber', 'title', 'documentType', 'status', 'createdAt', 'updatedAt'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    legalEntityId: { type: 'string', format: 'uuid' },
    plantId: { type: 'string', format: 'uuid' },
    documentNumber: { type: 'string', minLength: 3, maxLength: 64 },
    title: { type: 'string', minLength: 2, maxLength: 255 },
    documentType: {
      type: 'string',
      enum: ['DRAWING', 'SPECIFICATION', 'WORK_INSTRUCTION', 'ROUTING_TEMPLATE']
    },
    status: { type: 'string', enum: ['ACTIVE', 'ARCHIVED'] },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  },
  additionalProperties: false
} as const;

export const DocumentRevisionSchema = {
  $id: 'https://iems.org/schemas/engineering-repair/document-revision.json',
  type: 'object',
  required: ['id', 'documentId', 'revisionNumber', 'fileHash', 'fileSizeBytes', 'mimeType', 'status', 'createdAt'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    documentId: { type: 'string', format: 'uuid' },
    revisionNumber: { type: 'integer', minimum: 1 },
    fileHash: { type: 'string', minLength: 32, maxLength: 128 },
    fileSizeBytes: { type: 'integer', minimum: 1 },
    mimeType: { type: 'string', minLength: 3, maxLength: 128 },
    approvedBy: { type: 'string', format: 'uuid' },
    approvedAt: { type: 'string', format: 'date-time' },
    status: {
      type: 'string',
      enum: ['DRAFT', 'IN_REVIEW', 'APPROVED', 'SUPERSEDED', 'OBSOLETE']
    },
    createdAt: { type: 'string', format: 'date-time' }
  },
  additionalProperties: false
} as const;

export const BOMRevisionSchema = {
  $id: 'https://iems.org/schemas/engineering-repair/bom-revision.json',
  type: 'object',
  required: ['id', 'itemCode', 'plantId', 'revisionNumber', 'status', 'effectiveFrom', 'createdAt', 'updatedAt'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    itemCode: { type: 'string', minLength: 1, maxLength: 64 },
    plantId: { type: 'string', format: 'uuid' },
    revisionNumber: { type: 'integer', minimum: 1 },
    status: { type: 'string', enum: ['DRAFT', 'RELEASED', 'OBSOLETE'] },
    effectiveFrom: { type: 'string', format: 'date-time' },
    effectiveTo: { type: 'string', format: 'date-time' },
    releasedBy: { type: 'string', format: 'uuid' },
    releasedAt: { type: 'string', format: 'date-time' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  },
  additionalProperties: false
} as const;

export const BOMLineSchema = {
  $id: 'https://iems.org/schemas/engineering-repair/bom-line.json',
  type: 'object',
  required: [
    'id',
    'bomRevisionId',
    'lineNumber',
    'componentItemCode',
    'componentDescription',
    'quantityPerUnit',
    'uom',
    'scrapAllowancePercent',
    'isCritical'
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    bomRevisionId: { type: 'string', format: 'uuid' },
    lineNumber: { type: 'integer', minimum: 1 },
    componentItemCode: { type: 'string', minLength: 1, maxLength: 64 },
    componentDescription: { type: 'string', minLength: 1, maxLength: 255 },
    quantityPerUnit: { type: 'string', pattern: decimalPattern },
    uom: { type: 'string', enum: STANDARD_UOMS },
    scrapAllowancePercent: { type: 'string', pattern: decimalPattern },
    isCritical: { type: 'boolean' }
  },
  additionalProperties: false
} as const;

export const RoutingRevisionSchema = {
  $id: 'https://iems.org/schemas/engineering-repair/routing-revision.json',
  type: 'object',
  required: ['id', 'itemCode', 'plantId', 'revisionNumber', 'status', 'effectiveFrom', 'createdAt', 'updatedAt'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    itemCode: { type: 'string', minLength: 1, maxLength: 64 },
    plantId: { type: 'string', format: 'uuid' },
    revisionNumber: { type: 'integer', minimum: 1 },
    status: { type: 'string', enum: ['DRAFT', 'RELEASED', 'OBSOLETE'] },
    effectiveFrom: { type: 'string', format: 'date-time' },
    effectiveTo: { type: 'string', format: 'date-time' },
    releasedBy: { type: 'string', format: 'uuid' },
    releasedAt: { type: 'string', format: 'date-time' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  },
  additionalProperties: false
} as const;

export const RoutingOperationSchema = {
  $id: 'https://iems.org/schemas/engineering-repair/routing-operation.json',
  type: 'object',
  required: [
    'id',
    'routingRevisionId',
    'operationNumber',
    'operationName',
    'workcenterCode',
    'standardSetupHours',
    'standardRunHoursPerUnit',
    'requiredSkillCode',
    'requiredMachineType',
    'inspectionRequired'
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    routingRevisionId: { type: 'string', format: 'uuid' },
    operationNumber: { type: 'integer', minimum: 1 },
    operationName: { type: 'string', minLength: 2, maxLength: 128 },
    workcenterCode: { type: 'string', minLength: 2, maxLength: 64 },
    standardSetupHours: { type: 'string', pattern: decimalPattern },
    standardRunHoursPerUnit: { type: 'string', pattern: decimalPattern },
    requiredSkillCode: { type: 'string', minLength: 2, maxLength: 64 },
    requiredMachineType: { type: 'string', minLength: 2, maxLength: 64 },
    inspectionRequired: { type: 'boolean' }
  },
  additionalProperties: false
} as const;

export const CustomerAssetSchema = {
  $id: 'https://iems.org/schemas/engineering-repair/customer-asset.json',
  type: 'object',
  required: [
    'id',
    'customerId',
    'assetNumber',
    'serialNumber',
    'modelNumber',
    'manufacturer',
    'description',
    'ownershipStatus',
    'custodyPlantId',
    'custodyLocation',
    'conditionNotes',
    'receivedAt',
    'createdAt',
    'updatedAt'
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    customerId: { type: 'string', format: 'uuid' },
    assetNumber: { type: 'string', minLength: 2, maxLength: 64 },
    serialNumber: { type: 'string', minLength: 2, maxLength: 128 },
    modelNumber: { type: 'string', minLength: 2, maxLength: 128 },
    manufacturer: { type: 'string', minLength: 2, maxLength: 128 },
    description: { type: 'string', minLength: 2, maxLength: 255 },
    ownershipStatus: { type: 'string', enum: ['CUSTOMER_OWNED'] },
    custodyPlantId: { type: 'string', format: 'uuid' },
    custodyLocation: { type: 'string', minLength: 2, maxLength: 64 },
    conditionNotes: { type: 'string', maxLength: 2000 },
    receivedAt: { type: 'string', format: 'date-time' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  },
  additionalProperties: false
} as const;

export const RepairCaseSchema = {
  $id: 'https://iems.org/schemas/engineering-repair/repair-case.json',
  type: 'object',
  required: [
    'id',
    'customerAssetId',
    'legalEntityId',
    'plantId',
    'repairCaseNumber',
    'intakeConditionReport',
    'intakePhotosCount',
    'status',
    'intakeAt',
    'createdAt',
    'updatedAt'
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    customerAssetId: { type: 'string', format: 'uuid' },
    legalEntityId: { type: 'string', format: 'uuid' },
    plantId: { type: 'string', format: 'uuid' },
    repairCaseNumber: { type: 'string', minLength: 3, maxLength: 64 },
    intakeConditionReport: { type: 'string', minLength: 5, maxLength: 2000 },
    intakePhotosCount: { type: 'integer', minimum: 0 },
    status: {
      type: 'string',
      enum: [
        'RECEIVED',
        'INSPECTION',
        'AWAITING_AUTHORIZATION',
        'RELEASED',
        'IN_PROGRESS',
        'TEST',
        'RELEASED_FOR_RETURN',
        'RETURNED'
      ]
    },
    intakeAt: { type: 'string', format: 'date-time' },
    targetCompletionDate: { type: 'string', format: 'date-time' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  },
  additionalProperties: false
} as const;

export const DiagnosticAuthorizationSchema = {
  $id: 'https://iems.org/schemas/engineering-repair/diagnostic-authorization.json',
  type: 'object',
  required: [
    'id',
    'repairCaseId',
    'authorizedScopeDescription',
    'authorizedCostCap',
    'currency',
    'approvedByCustomer',
    'approvedAt',
    'authorizedDiagnosticHours',
    'status',
    'createdAt'
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    repairCaseId: { type: 'string', format: 'uuid' },
    authorizedScopeDescription: { type: 'string', minLength: 5, maxLength: 2000 },
    authorizedCostCap: { type: 'string', pattern: decimalPattern },
    currency: { type: 'string', enum: ISO_CURRENCIES },
    approvedByCustomer: { type: 'string', minLength: 2, maxLength: 128 },
    approvedAt: { type: 'string', format: 'date-time' },
    authorizedDiagnosticHours: { type: 'string', pattern: decimalPattern },
    status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED'] },
    createdAt: { type: 'string', format: 'date-time' }
  },
  additionalProperties: false
} as const;

export const TeardownFindingSchema = {
  $id: 'https://iems.org/schemas/engineering-repair/teardown-finding.json',
  type: 'object',
  required: [
    'id',
    'repairCaseId',
    'findingNumber',
    'componentIdentifier',
    'componentDescription',
    'observedDefect',
    'failureMode',
    'severity',
    'discoveredBy',
    'discoveredAt'
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    repairCaseId: { type: 'string', format: 'uuid' },
    findingNumber: { type: 'integer', minimum: 1 },
    componentIdentifier: { type: 'string', minLength: 2, maxLength: 64 },
    componentDescription: { type: 'string', minLength: 2, maxLength: 255 },
    observedDefect: { type: 'string', minLength: 5, maxLength: 1000 },
    failureMode: { type: 'string', minLength: 2, maxLength: 128 },
    severity: { type: 'string', enum: ['CRITICAL', 'MAJOR', 'MINOR'] },
    discoveredBy: { type: 'string', format: 'uuid' },
    discoveredAt: { type: 'string', format: 'date-time' }
  },
  additionalProperties: false
} as const;

export const DispositionSchema = {
  $id: 'https://iems.org/schemas/engineering-repair/disposition.json',
  type: 'object',
  required: [
    'id',
    'teardownFindingId',
    'dispositionType',
    'customerApprovalRequired',
    'customerApproved',
    'authorizedCostDelta',
    'technicalJustification',
    'createdAt'
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    teardownFindingId: { type: 'string', format: 'uuid' },
    dispositionType: { type: 'string', enum: ['REUSE', 'REPAIR', 'REPLACE', 'SCRAP'] },
    customerApprovalRequired: { type: 'boolean' },
    customerApproved: { type: 'boolean' },
    authorizedCostDelta: { type: 'string', pattern: signedDecimalPattern },
    technicalJustification: { type: 'string', minLength: 5, maxLength: 2000 },
    approvedBy: { type: 'string', format: 'uuid' },
    approvedAt: { type: 'string', format: 'date-time' },
    createdAt: { type: 'string', format: 'date-time' }
  },
  additionalProperties: false
} as const;

export const ComponentInstallationSchema = {
  $id: 'https://iems.org/schemas/engineering-repair/component-installation.json',
  type: 'object',
  required: [
    'id',
    'parentAssetId',
    'childComponentItemCode',
    'position',
    'installedAt',
    'installationWorkOrderId'
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    parentAssetId: { type: 'string', format: 'uuid' },
    childAssetId: { type: 'string', format: 'uuid' },
    childComponentItemCode: { type: 'string', minLength: 1, maxLength: 64 },
    childSerialNumber: { type: 'string', maxLength: 128 },
    childLotNumber: { type: 'string', maxLength: 64 },
    position: { type: 'string', minLength: 1, maxLength: 64 },
    installedAt: { type: 'string', format: 'date-time' },
    removedAt: { type: 'string', format: 'date-time' },
    installationWorkOrderId: { type: 'string', format: 'uuid' },
    removalWorkOrderId: { type: 'string', format: 'uuid' }
  },
  additionalProperties: false
} as const;

export const WarrantyClaimSchema = {
  $id: 'https://iems.org/schemas/engineering-repair/warranty-claim.json',
  type: 'object',
  required: ['id', 'customerAssetId', 'claimNumber', 'claimDate', 'failureDescription', 'claimStatus', 'resolutionCost', 'createdAt', 'updatedAt'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    repairCaseId: { type: 'string', format: 'uuid' },
    salesOrderLineId: { type: 'string', format: 'uuid' },
    customerAssetId: { type: 'string', format: 'uuid' },
    claimNumber: { type: 'string', minLength: 3, maxLength: 64 },
    claimDate: { type: 'string', format: 'date-time' },
    failureDescription: { type: 'string', minLength: 5, maxLength: 2000 },
    claimStatus: {
      type: 'string',
      enum: ['SUBMITTED', 'UNDER_INVESTIGATION', 'APPROVED', 'REJECTED', 'CLOSED']
    },
    originalShipmentId: { type: 'string', format: 'uuid' },
    originalInvoiceId: { type: 'string', format: 'uuid' },
    settlementResolution: { type: 'string', maxLength: 2000 },
    resolutionCost: { type: 'string', pattern: decimalPattern },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  },
  additionalProperties: false
} as const;
