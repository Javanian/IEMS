/**
 * Planning & Execution Domain JSON Schemas
 */

import { STANDARD_UOMS } from '../../common/decimal.js';

const decimalPattern = '^[0-9]+(\\.[0-9]+)?$';

export const WorkOrderSchema = {
  $id: 'https://iems.org/schemas/planning-execution/work-order.json',
  type: 'object',
  required: [
    'id',
    'legalEntityId',
    'plantId',
    'workOrderNumber',
    'itemCode',
    'orderMode',
    'plannedQuantity',
    'uom',
    'completedQuantity',
    'scrappedQuantity',
    'reworkQuantity',
    'scheduledStartDate',
    'scheduledEndDate',
    'status',
    'version',
    'createdAt',
    'updatedAt'
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    legalEntityId: { type: 'string', format: 'uuid' },
    plantId: { type: 'string', format: 'uuid' },
    workOrderNumber: { type: 'string', minLength: 3, maxLength: 64 },
    salesOrderLineId: { type: 'string', format: 'uuid' },
    repairCaseId: { type: 'string', format: 'uuid' },
    itemCode: { type: 'string', minLength: 1, maxLength: 64 },
    orderMode: { type: 'string', enum: ['MANUFACTURING', 'REPAIR', 'REWORK'] },
    bomRevisionId: { type: 'string', format: 'uuid' },
    routingRevisionId: { type: 'string', format: 'uuid' },
    plannedQuantity: { type: 'string', pattern: decimalPattern },
    uom: { type: 'string', enum: STANDARD_UOMS },
    completedQuantity: { type: 'string', pattern: decimalPattern },
    scrappedQuantity: { type: 'string', pattern: decimalPattern },
    reworkQuantity: { type: 'string', pattern: decimalPattern },
    scheduledStartDate: { type: 'string', format: 'date-time' },
    scheduledEndDate: { type: 'string', format: 'date-time' },
    actualStartDate: { type: 'string', format: 'date-time' },
    actualEndDate: { type: 'string', format: 'date-time' },
    status: {
      type: 'string',
      enum: [
        'DRAFT',
        'PLANNED',
        'RELEASED',
        'RUNNING',
        'COMPLETED',
        'CLOSED',
        'ON_HOLD',
        'CANCELLED'
      ]
    },
    holdReason: { type: 'string', maxLength: 1000 },
    version: { type: 'integer', minimum: 1 },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  },
  additionalProperties: false
} as const;

export const WorkOperationSchema = {
  $id: 'https://iems.org/schemas/planning-execution/work-operation.json',
  type: 'object',
  required: [
    'id',
    'workOrderId',
    'operationNumber',
    'operationName',
    'workcenterCode',
    'standardRunHours',
    'standardSetupHours',
    'actualSetupHours',
    'actualRunHours',
    'status',
    'completedQuantity',
    'scrappedQuantity',
    'requiredSkillCode'
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    workOrderId: { type: 'string', format: 'uuid' },
    operationNumber: { type: 'integer', minimum: 1 },
    operationName: { type: 'string', minLength: 2, maxLength: 128 },
    workcenterCode: { type: 'string', minLength: 2, maxLength: 64 },
    standardRunHours: { type: 'string', pattern: decimalPattern },
    standardSetupHours: { type: 'string', pattern: decimalPattern },
    actualSetupHours: { type: 'string', pattern: decimalPattern },
    actualRunHours: { type: 'string', pattern: decimalPattern },
    status: { type: 'string', enum: ['READY', 'RUNNING', 'PAUSED', 'COMPLETED', 'SKIPPED'] },
    completedQuantity: { type: 'string', pattern: decimalPattern },
    scrappedQuantity: { type: 'string', pattern: decimalPattern },
    requiredSkillCode: { type: 'string', minLength: 2, maxLength: 64 }
  },
  additionalProperties: false
} as const;

export const ExecutionSessionSchema = {
  $id: 'https://iems.org/schemas/planning-execution/execution-session.json',
  type: 'object',
  required: [
    'id',
    'workOperationId',
    'employeeId',
    'badgeId',
    'machineCode',
    'sessionType',
    'startTime',
    'durationMinutes',
    'status'
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    workOperationId: { type: 'string', format: 'uuid' },
    employeeId: { type: 'string', minLength: 2, maxLength: 64 },
    badgeId: { type: 'string', minLength: 2, maxLength: 64 },
    machineCode: { type: 'string', minLength: 2, maxLength: 64 },
    sessionType: { type: 'string', enum: ['SETUP', 'RUN', 'DOWNTIME'] },
    startTime: { type: 'string', format: 'date-time' },
    endTime: { type: 'string', format: 'date-time' },
    durationMinutes: { type: 'string', pattern: decimalPattern },
    pauseReason: { type: 'string', maxLength: 500 },
    status: { type: 'string', enum: ['RUNNING', 'CLOSED', 'ADJUSTED'] }
  },
  additionalProperties: false
} as const;

export const MaterialConsumptionSchema = {
  $id: 'https://iems.org/schemas/planning-execution/material-consumption.json',
  type: 'object',
  required: [
    'id',
    'workOrderId',
    'workOperationId',
    'itemCode',
    'quantityConsumed',
    'uom',
    'consumedAt',
    'employeeId',
    'isScrap'
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    workOrderId: { type: 'string', format: 'uuid' },
    workOperationId: { type: 'string', format: 'uuid' },
    itemCode: { type: 'string', minLength: 1, maxLength: 64 },
    lotNumber: { type: 'string', maxLength: 64 },
    serialNumber: { type: 'string', maxLength: 128 },
    quantityConsumed: { type: 'string', pattern: decimalPattern },
    uom: { type: 'string', enum: STANDARD_UOMS },
    stockMovementLineId: { type: 'string', format: 'uuid' },
    consumedAt: { type: 'string', format: 'date-time' },
    employeeId: { type: 'string', minLength: 2, maxLength: 64 },
    isScrap: { type: 'boolean' }
  },
  additionalProperties: false
} as const;

export const OutputUnitSchema = {
  $id: 'https://iems.org/schemas/planning-execution/output-unit.json',
  type: 'object',
  required: [
    'id',
    'workOrderId',
    'workOperationId',
    'quantityProduced',
    'uom',
    'qualityStatus',
    'producedAt',
    'employeeId'
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    workOrderId: { type: 'string', format: 'uuid' },
    workOperationId: { type: 'string', format: 'uuid' },
    serialNumber: { type: 'string', maxLength: 128 },
    lotNumber: { type: 'string', maxLength: 64 },
    quantityProduced: { type: 'string', pattern: decimalPattern },
    uom: { type: 'string', enum: STANDARD_UOMS },
    qualityStatus: {
      type: 'string',
      enum: ['PENDING_INSPECTION', 'ACCEPTED', 'REJECTED', 'CONCESSION']
    },
    producedAt: { type: 'string', format: 'date-time' },
    employeeId: { type: 'string', minLength: 2, maxLength: 64 }
  },
  additionalProperties: false
} as const;

export const ScrapRecordSchema = {
  $id: 'https://iems.org/schemas/planning-execution/scrap-record.json',
  type: 'object',
  required: [
    'id',
    'workOrderId',
    'workOperationId',
    'itemCode',
    'quantityScrapped',
    'uom',
    'defectCode',
    'defectReason',
    'dispositionApprovedBy',
    'scrappedAt'
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    workOrderId: { type: 'string', format: 'uuid' },
    workOperationId: { type: 'string', format: 'uuid' },
    itemCode: { type: 'string', minLength: 1, maxLength: 64 },
    quantityScrapped: { type: 'string', pattern: decimalPattern },
    uom: { type: 'string', enum: STANDARD_UOMS },
    defectCode: { type: 'string', minLength: 2, maxLength: 64 },
    defectReason: { type: 'string', minLength: 5, maxLength: 500 },
    dispositionApprovedBy: { type: 'string', format: 'uuid' },
    scrappedAt: { type: 'string', format: 'date-time' }
  },
  additionalProperties: false
} as const;

export const ReworkOrderSchema = {
  $id: 'https://iems.org/schemas/planning-execution/rework-order.json',
  type: 'object',
  required: [
    'id',
    'parentWorkOrderId',
    'originOutputUnitId',
    'reworkOrderNumber',
    'reworkReason',
    'targetWorkOperationId',
    'plannedHours',
    'status',
    'createdAt',
    'updatedAt'
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    parentWorkOrderId: { type: 'string', format: 'uuid' },
    originOutputUnitId: { type: 'string', format: 'uuid' },
    reworkOrderNumber: { type: 'string', minLength: 3, maxLength: 64 },
    reworkReason: { type: 'string', minLength: 5, maxLength: 500 },
    targetWorkOperationId: { type: 'string', format: 'uuid' },
    plannedHours: { type: 'string', pattern: decimalPattern },
    status: { type: 'string', enum: ['PLANNED', 'RELEASED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  },
  additionalProperties: false
} as const;
