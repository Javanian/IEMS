/**
 * Logistics & Billing Domain Types
 *
 * Covers Stock Movements, Inventory Reservations, Shipments, Fulfillment Allocations,
 * Invoices (Delivery, Milestone, Deposit, Credit Note), Billing Allocations,
 * Payment Allocations, and Deposit Applications.
 */

import type { DecimalString, CurrencyCode, UnitOfMeasure } from '../../common/decimal.js';

export type StockMovementType =
  | 'GOODS_RECEIPT'
  | 'GOODS_ISSUE'
  | 'TRANSFER'
  | 'ADJUSTMENT'
  | 'SCRAP'
  | 'REVERSAL';

export type InventoryOwnerType = 'COMPANY' | 'CUSTOMER';
export type ReferenceDocumentType = 'WORK_ORDER' | 'SALES_ORDER' | 'PURCHASE_ORDER' | 'RETURN';

export interface StockMovement {
  id: string;
  plantId: string;
  movementNumber: string;
  movementType: StockMovementType;
  sourceLocation: string;
  destinationLocation: string;
  inventoryOwnerId: InventoryOwnerType;
  referenceDocumentType: ReferenceDocumentType;
  referenceDocumentId: string;
  postedAt: string;
  postedBy: string;
  isReversed: boolean;
  reverseMovementId?: string;
}

export type ReservationType = 'WORK_ORDER' | 'SALES_ORDER' | 'TRANSFER';
export type ReservationStatus = 'ACTIVE' | 'FULFILLED' | 'RELEASED' | 'CANCELLED';

export interface Reservation {
  id: string;
  plantId: string;
  reservationNumber: string;
  reservationType: ReservationType;
  itemCode: string;
  plantLocation: string;
  requestedQuantity: DecimalString;
  reservedQuantity: DecimalString;
  uom: UnitOfMeasure;
  lotNumber?: string;
  serialNumber?: string;
  status: ReservationStatus;
  requiredDate: string;
  workOrderId?: string;
  salesOrderId?: string;
}

export type ShipmentStatus =
  | 'DRAFT'
  | 'PICKED'
  | 'PACKED'
  | 'RELEASED'
  | 'DISPATCHED'
  | 'DELIVERED'
  | 'CANCELLED';

export interface Shipment {
  id: string;
  legalEntityId: string;
  plantId: string;
  shipmentNumber: string;
  customerId: string;
  destinationAddress: string;
  carrierName: string;
  trackingNumber: string;
  status: ShipmentStatus;
  dispatchedAt?: string;
  deliveredAt?: string;
  proofOfDeliveryReference?: string;
  proofOfDeliveryReceivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShipmentLine {
  id: string;
  shipmentId: string;
  lineNumber: number;
  salesOrderLineId: string;
  itemCode: string;
  quantityShipped: DecimalString;
  uom: UnitOfMeasure;
  trackingLotNumber?: string;
  trackingSerialNumber?: string;
  packageReference?: string;
}

export type FulfillmentSourceType = 'PRODUCTION_OUTPUT' | 'INVENTORY_LOT' | 'CUSTOMER_ASSET';

export interface FulfillmentAllocation {
  id: string;
  shipmentLineId: string;
  salesOrderLineId: string;
  fulfillmentSourceType: FulfillmentSourceType;
  productionOutputUnitId?: string;
  stockPositionId?: string;
  customerAssetId?: string;
  allocatedQuantity: DecimalString;
  uom: UnitOfMeasure;
  allocatedAt: string;
}

export type InvoiceType =
  | 'COMMERCIAL_DELIVERY'
  | 'SERVICE_MILESTONE'
  | 'ADVANCE_DEPOSIT'
  | 'CREDIT_NOTE';

export type InvoiceStatus =
  | 'DRAFT'
  | 'APPROVED'
  | 'POSTED'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'CANCELLED';

export interface Invoice {
  id: string;
  legalEntityId: string;
  billingPlantId: string;
  invoiceNumber: string;
  customerId: string;
  invoiceType: InvoiceType;
  invoiceDate: string;
  dueDate: string;
  currency: CurrencyCode;
  subtotal: DecimalString;
  taxAmount: DecimalString;
  totalAmount: DecimalString;
  paidAmount: DecimalString;
  balanceDue: DecimalString;
  status: InvoiceStatus;
  postedAt?: string;
  postedBy?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type BillingSourceType = 'DELIVERY' | 'MILESTONE';

export interface InvoiceLine {
  id: string;
  invoiceId: string;
  lineNumber: number;
  billingSourceType: BillingSourceType;
  deliveryBillingAllocationId?: string;
  milestoneBillingAllocationId?: string;
  description: string;
  quantity: DecimalString;
  uom: UnitOfMeasure;
  unitPrice: DecimalString;
  taxRate: DecimalString;
  lineTotal: DecimalString;
}

export interface DeliveryBillingAllocation {
  id: string;
  invoiceLineId: string;
  shipmentLineId: string;
  salesOrderLineId: string;
  billingEntitlementId: string;
  billedQuantity: DecimalString;
  billedAmount: DecimalString;
  currency: CurrencyCode;
  reconciledAt: string;
}

export interface MilestoneBillingAllocation {
  id: string;
  invoiceLineId: string;
  salesOrderId: string;
  salesOrderLineId: string;
  billingEntitlementId: string;
  milestoneDescription: string;
  milestonePercentage: DecimalString;
  billedAmount: DecimalString;
  currency: CurrencyCode;
  reconciledAt: string;
}

export type PaymentMethod = 'BANK_TRANSFER' | 'CHECK' | 'CASH' | 'CREDIT_OFFSET';

export interface PaymentAllocation {
  id: string;
  invoiceId: string;
  paymentReferenceNumber: string;
  paymentDate: string;
  paymentMethod: PaymentMethod;
  allocatedAmount: DecimalString;
  currency: CurrencyCode;
  bankFeeAmount: DecimalString;
  appliedBy: string;
  notes?: string;
}

export interface DepositApplication {
  id: string;
  finalInvoiceId: string;
  depositInvoiceId: string;
  prepaymentReference: string;
  appliedDepositAmount: DecimalString;
  currency: CurrencyCode;
  appliedAt: string;
  approvedBy: string;
}
