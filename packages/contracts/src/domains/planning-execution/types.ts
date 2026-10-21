/**
 * Planning & Execution Domain Types
 *
 * Covers Work Orders, Work Operations, Execution Sessions (Labor & Machine),
 * Material Consumptions, Produced Output Units, Scrap Records, and Rework Orders.
 */

import type { DecimalString, UnitOfMeasure } from '../../common/decimal.js';

export type WorkOrderMode = 'MANUFACTURING' | 'REPAIR' | 'REWORK';
export type WorkOrderStatus =
  | 'DRAFT'
  | 'PLANNED'
  | 'RELEASED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'CLOSED'
  | 'ON_HOLD'
  | 'CANCELLED';

export interface WorkOrder {
  id: string;
  legalEntityId: string;
  plantId: string;
  workOrderNumber: string;
  salesOrderLineId?: string;
  repairCaseId?: string;
  itemCode: string;
  orderMode: WorkOrderMode;
  bomRevisionId?: string;
  routingRevisionId?: string;
  plannedQuantity: DecimalString;
  uom: UnitOfMeasure;
  completedQuantity: DecimalString;
  scrappedQuantity: DecimalString;
  reworkQuantity: DecimalString;
  scheduledStartDate: string;
  scheduledEndDate: string;
  actualStartDate?: string;
  actualEndDate?: string;
  status: WorkOrderStatus;
  holdReason?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type OperationStatus = 'READY' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'SKIPPED';

export interface WorkOperation {
  id: string;
  workOrderId: string;
  operationNumber: number;
  operationName: string;
  workcenterCode: string;
  standardRunHours: DecimalString;
  standardSetupHours: DecimalString;
  actualSetupHours: DecimalString;
  actualRunHours: DecimalString;
  status: OperationStatus;
  completedQuantity: DecimalString;
  scrappedQuantity: DecimalString;
  requiredSkillCode: string;
}

export type SessionType = 'SETUP' | 'RUN' | 'DOWNTIME';
export type SessionStatus = 'RUNNING' | 'CLOSED' | 'ADJUSTED';

export interface ExecutionSession {
  id: string;
  workOperationId: string;
  employeeId: string;
  badgeId: string;
  machineCode: string;
  sessionType: SessionType;
  startTime: string;
  endTime?: string;
  durationMinutes: DecimalString;
  pauseReason?: string;
  status: SessionStatus;
}

export interface MaterialConsumption {
  id: string;
  workOrderId: string;
  workOperationId: string;
  itemCode: string;
  lotNumber?: string;
  serialNumber?: string;
  quantityConsumed: DecimalString;
  uom: UnitOfMeasure;
  stockMovementLineId?: string;
  consumedAt: string;
  employeeId: string;
  isScrap: boolean;
}

export type QualityOutputStatus = 'PENDING_INSPECTION' | 'ACCEPTED' | 'REJECTED' | 'CONCESSION';

export interface OutputUnit {
  id: string;
  workOrderId: string;
  workOperationId: string;
  serialNumber?: string;
  lotNumber?: string;
  quantityProduced: DecimalString;
  uom: UnitOfMeasure;
  qualityStatus: QualityOutputStatus;
  producedAt: string;
  employeeId: string;
}

export interface ScrapRecord {
  id: string;
  workOrderId: string;
  workOperationId: string;
  itemCode: string;
  quantityScrapped: DecimalString;
  uom: UnitOfMeasure;
  defectCode: string;
  defectReason: string;
  dispositionApprovedBy: string;
  scrappedAt: string;
}

export type ReworkOrderStatus = 'PLANNED' | 'RELEASED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export interface ReworkOrder {
  id: string;
  parentWorkOrderId: string;
  originOutputUnitId: string;
  reworkOrderNumber: string;
  reworkReason: string;
  targetWorkOperationId: string;
  plannedHours: DecimalString;
  status: ReworkOrderStatus;
  createdAt: string;
  updatedAt: string;
}
