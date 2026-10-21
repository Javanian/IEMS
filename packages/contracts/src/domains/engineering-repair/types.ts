/**
 * Engineering & Repair Domain Types
 *
 * Covers Engineering Documents, BOM & Routing Revisions, Operations,
 * Customer Assets, Repair Intake, Diagnostic Authorizations, Teardown Findings,
 * Component Dispositions, Component Installations, and Warranty Claims.
 */

import type { DecimalString, SignedDecimalString, CurrencyCode, UnitOfMeasure } from '../../common/decimal.js';

export type DocumentType = 'DRAWING' | 'SPECIFICATION' | 'WORK_INSTRUCTION' | 'ROUTING_TEMPLATE';

export interface Document {
  id: string;
  legalEntityId: string;
  plantId: string;
  documentNumber: string;
  title: string;
  documentType: DocumentType;
  status: 'ACTIVE' | 'ARCHIVED';
  createdAt: string;
  updatedAt: string;
}

export type DocumentRevisionStatus = 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'SUPERSEDED' | 'OBSOLETE';

export interface DocumentRevision {
  id: string;
  documentId: string;
  revisionNumber: number;
  fileHash: string;
  fileSizeBytes: number;
  mimeType: string;
  approvedBy?: string;
  approvedAt?: string;
  status: DocumentRevisionStatus;
  createdAt: string;
}

export type EngineeringRevisionStatus = 'DRAFT' | 'RELEASED' | 'OBSOLETE';

export interface BOMRevision {
  id: string;
  itemCode: string;
  plantId: string;
  revisionNumber: number;
  status: EngineeringRevisionStatus;
  effectiveFrom: string;
  effectiveTo?: string;
  releasedBy?: string;
  releasedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BOMLine {
  id: string;
  bomRevisionId: string;
  lineNumber: number;
  componentItemCode: string;
  componentDescription: string;
  quantityPerUnit: DecimalString;
  uom: UnitOfMeasure;
  scrapAllowancePercent: DecimalString;
  isCritical: boolean;
}

export interface RoutingRevision {
  id: string;
  itemCode: string;
  plantId: string;
  revisionNumber: number;
  status: EngineeringRevisionStatus;
  effectiveFrom: string;
  effectiveTo?: string;
  releasedBy?: string;
  releasedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RoutingOperation {
  id: string;
  routingRevisionId: string;
  operationNumber: number;
  operationName: string;
  workcenterCode: string;
  standardSetupHours: DecimalString;
  standardRunHoursPerUnit: DecimalString;
  requiredSkillCode: string;
  requiredMachineType: string;
  inspectionRequired: boolean;
}

export interface CustomerAsset {
  id: string;
  customerId: string;
  assetNumber: string;
  serialNumber: string;
  modelNumber: string;
  manufacturer: string;
  description: string;
  ownershipStatus: 'CUSTOMER_OWNED';
  custodyPlantId: string;
  custodyLocation: string;
  conditionNotes: string;
  receivedAt: string;
  createdAt: string;
  updatedAt: string;
}

export type RepairCaseStatus =
  | 'RECEIVED'
  | 'INSPECTION'
  | 'AWAITING_AUTHORIZATION'
  | 'RELEASED'
  | 'IN_PROGRESS'
  | 'TEST'
  | 'RELEASED_FOR_RETURN'
  | 'RETURNED';

export interface RepairCase {
  id: string;
  customerAssetId: string;
  legalEntityId: string;
  plantId: string;
  repairCaseNumber: string;
  intakeConditionReport: string;
  intakePhotosCount: number;
  status: RepairCaseStatus;
  intakeAt: string;
  targetCompletionDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DiagnosticAuthorization {
  id: string;
  repairCaseId: string;
  authorizedScopeDescription: string;
  authorizedCostCap: DecimalString;
  currency: CurrencyCode;
  approvedByCustomer: string;
  approvedAt: string;
  authorizedDiagnosticHours: DecimalString;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  createdAt: string;
}

export interface TeardownFinding {
  id: string;
  repairCaseId: string;
  findingNumber: number;
  componentIdentifier: string;
  componentDescription: string;
  observedDefect: string;
  failureMode: string;
  severity: 'CRITICAL' | 'MAJOR' | 'MINOR';
  discoveredBy: string;
  discoveredAt: string;
}

export type DispositionType = 'REUSE' | 'REPAIR' | 'REPLACE' | 'SCRAP';

export interface Disposition {
  id: string;
  teardownFindingId: string;
  dispositionType: DispositionType;
  customerApprovalRequired: boolean;
  customerApproved: boolean;
  authorizedCostDelta: SignedDecimalString;
  technicalJustification: string;
  approvedBy?: string;
  approvedAt?: string;
  createdAt: string;
}

export interface ComponentInstallation {
  id: string;
  parentAssetId: string;
  childAssetId?: string;
  childComponentItemCode: string;
  childSerialNumber?: string;
  childLotNumber?: string;
  position: string;
  installedAt: string;
  removedAt?: string;
  installationWorkOrderId: string;
  removalWorkOrderId?: string;
}

export type WarrantyClaimStatus = 'SUBMITTED' | 'UNDER_INVESTIGATION' | 'APPROVED' | 'REJECTED' | 'CLOSED';

export interface WarrantyClaim {
  id: string;
  repairCaseId?: string;
  salesOrderLineId?: string;
  customerAssetId: string;
  claimNumber: string;
  claimDate: string;
  failureDescription: string;
  claimStatus: WarrantyClaimStatus;
  originalShipmentId?: string;
  originalInvoiceId?: string;
  settlementResolution?: string;
  resolutionCost: DecimalString;
  createdAt: string;
  updatedAt: string;
}
