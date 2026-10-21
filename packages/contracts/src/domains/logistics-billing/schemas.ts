/**
 * Logistics & Billing Domain JSON Schemas
 */

import { ISO_CURRENCIES, STANDARD_UOMS } from '../../common/decimal.js';

const decimalPattern = '^[0-9]+(\\.[0-9]+)?$';

export const StockMovementSchema = {
  $id: 'https://iems.org/schemas/logistics-billing/stock-movement.json',
  type: 'object',
  required: [
    'id',
    'plantId',
    'movementNumber',
    'movementType',
    'sourceLocation',
    'destinationLocation',
    'inventoryOwnerId',
    'referenceDocumentType',
    'referenceDocumentId',
    'postedAt',
    'postedBy',
    'isReversed'
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    plantId: { type: 'string', format: 'uuid' },
    movementNumber: { type: 'string', minLength: 3, maxLength: 64 },
    movementType: {
      type: 'string',
      enum: ['GOODS_RECEIPT', 'GOODS_ISSUE', 'TRANSFER', 'ADJUSTMENT', 'SCRAP', 'REVERSAL']
    },
    sourceLocation: { type: 'string', minLength: 2, maxLength: 64 },
    destinationLocation: { type: 'string', minLength: 2, maxLength: 64 },
    inventoryOwnerId: { type: 'string', enum: ['COMPANY', 'CUSTOMER'] },
    referenceDocumentType: {
      type: 'string',
      enum: ['WORK_ORDER', 'SALES_ORDER', 'PURCHASE_ORDER', 'RETURN']
    },
    referenceDocumentId: { type: 'string', minLength: 3, maxLength: 64 },
    postedAt: { type: 'string', format: 'date-time' },
    postedBy: { type: 'string', format: 'uuid' },
    isReversed: { type: 'boolean' },
    reverseMovementId: { type: 'string', format: 'uuid' }
  },
  additionalProperties: false
} as const;

export const ReservationSchema = {
  $id: 'https://iems.org/schemas/logistics-billing/reservation.json',
  type: 'object',
  required: [
    'id',
    'plantId',
    'reservationNumber',
    'reservationType',
    'itemCode',
    'plantLocation',
    'requestedQuantity',
    'reservedQuantity',
    'uom',
    'status',
    'requiredDate'
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    plantId: { type: 'string', format: 'uuid' },
    reservationNumber: { type: 'string', minLength: 3, maxLength: 64 },
    reservationType: { type: 'string', enum: ['WORK_ORDER', 'SALES_ORDER', 'TRANSFER'] },
    itemCode: { type: 'string', minLength: 1, maxLength: 64 },
    plantLocation: { type: 'string', minLength: 2, maxLength: 64 },
    requestedQuantity: { type: 'string', pattern: decimalPattern },
    reservedQuantity: { type: 'string', pattern: decimalPattern },
    uom: { type: 'string', enum: STANDARD_UOMS },
    lotNumber: { type: 'string', maxLength: 64 },
    serialNumber: { type: 'string', maxLength: 128 },
    status: { type: 'string', enum: ['ACTIVE', 'FULFILLED', 'RELEASED', 'CANCELLED'] },
    requiredDate: { type: 'string', format: 'date-time' },
    workOrderId: { type: 'string', format: 'uuid' },
    salesOrderId: { type: 'string', format: 'uuid' }
  },
  additionalProperties: false
} as const;

export const ShipmentSchema = {
  $id: 'https://iems.org/schemas/logistics-billing/shipment.json',
  type: 'object',
  required: [
    'id',
    'legalEntityId',
    'plantId',
    'shipmentNumber',
    'customerId',
    'destinationAddress',
    'carrierName',
    'trackingNumber',
    'status',
    'createdAt',
    'updatedAt'
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    legalEntityId: { type: 'string', format: 'uuid' },
    plantId: { type: 'string', format: 'uuid' },
    shipmentNumber: { type: 'string', minLength: 3, maxLength: 64 },
    customerId: { type: 'string', format: 'uuid' },
    destinationAddress: { type: 'string', minLength: 5, maxLength: 500 },
    carrierName: { type: 'string', minLength: 2, maxLength: 128 },
    trackingNumber: { type: 'string', minLength: 2, maxLength: 128 },
    status: {
      type: 'string',
      enum: ['DRAFT', 'PICKED', 'PACKED', 'RELEASED', 'DISPATCHED', 'DELIVERED', 'CANCELLED']
    },
    dispatchedAt: { type: 'string', format: 'date-time' },
    deliveredAt: { type: 'string', format: 'date-time' },
    proofOfDeliveryReference: { type: 'string', maxLength: 255 },
    proofOfDeliveryReceivedAt: { type: 'string', format: 'date-time' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  },
  additionalProperties: false
} as const;

export const ShipmentLineSchema = {
  $id: 'https://iems.org/schemas/logistics-billing/shipment-line.json',
  type: 'object',
  required: [
    'id',
    'shipmentId',
    'lineNumber',
    'salesOrderLineId',
    'itemCode',
    'quantityShipped',
    'uom'
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    shipmentId: { type: 'string', format: 'uuid' },
    lineNumber: { type: 'integer', minimum: 1 },
    salesOrderLineId: { type: 'string', format: 'uuid' },
    itemCode: { type: 'string', minLength: 1, maxLength: 64 },
    quantityShipped: { type: 'string', pattern: decimalPattern },
    uom: { type: 'string', enum: STANDARD_UOMS },
    trackingLotNumber: { type: 'string', maxLength: 64 },
    trackingSerialNumber: { type: 'string', maxLength: 128 },
    packageReference: { type: 'string', maxLength: 64 }
  },
  additionalProperties: false
} as const;

export const FulfillmentAllocationSchema = {
  $id: 'https://iems.org/schemas/logistics-billing/fulfillment-allocation.json',
  type: 'object',
  required: [
    'id',
    'shipmentLineId',
    'salesOrderLineId',
    'fulfillmentSourceType',
    'allocatedQuantity',
    'uom',
    'allocatedAt'
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    shipmentLineId: { type: 'string', format: 'uuid' },
    salesOrderLineId: { type: 'string', format: 'uuid' },
    fulfillmentSourceType: {
      type: 'string',
      enum: ['PRODUCTION_OUTPUT', 'INVENTORY_LOT', 'CUSTOMER_ASSET']
    },
    productionOutputUnitId: { type: 'string', format: 'uuid' },
    stockPositionId: { type: 'string', format: 'uuid' },
    customerAssetId: { type: 'string', format: 'uuid' },
    allocatedQuantity: { type: 'string', pattern: decimalPattern },
    uom: { type: 'string', enum: STANDARD_UOMS },
    allocatedAt: { type: 'string', format: 'date-time' }
  },
  additionalProperties: false
} as const;

export const InvoiceSchema = {
  $id: 'https://iems.org/schemas/logistics-billing/invoice.json',
  type: 'object',
  required: [
    'id',
    'legalEntityId',
    'billingPlantId',
    'invoiceNumber',
    'customerId',
    'invoiceType',
    'invoiceDate',
    'dueDate',
    'currency',
    'subtotal',
    'taxAmount',
    'totalAmount',
    'paidAmount',
    'balanceDue',
    'status',
    'version',
    'createdAt',
    'updatedAt'
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    legalEntityId: { type: 'string', format: 'uuid' },
    billingPlantId: { type: 'string', format: 'uuid' },
    invoiceNumber: { type: 'string', minLength: 3, maxLength: 64 },
    customerId: { type: 'string', format: 'uuid' },
    invoiceType: {
      type: 'string',
      enum: ['COMMERCIAL_DELIVERY', 'SERVICE_MILESTONE', 'ADVANCE_DEPOSIT', 'CREDIT_NOTE']
    },
    invoiceDate: { type: 'string', format: 'date-time' },
    dueDate: { type: 'string', format: 'date-time' },
    currency: { type: 'string', enum: ISO_CURRENCIES },
    subtotal: { type: 'string', pattern: decimalPattern },
    taxAmount: { type: 'string', pattern: decimalPattern },
    totalAmount: { type: 'string', pattern: decimalPattern },
    paidAmount: { type: 'string', pattern: decimalPattern },
    balanceDue: { type: 'string', pattern: decimalPattern },
    status: {
      type: 'string',
      enum: ['DRAFT', 'APPROVED', 'POSTED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED']
    },
    postedAt: { type: 'string', format: 'date-time' },
    postedBy: { type: 'string', format: 'uuid' },
    version: { type: 'integer', minimum: 1 },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  },
  additionalProperties: false
} as const;

export const InvoiceLineSchema = {
  $id: 'https://iems.org/schemas/logistics-billing/invoice-line.json',
  type: 'object',
  required: [
    'id',
    'invoiceId',
    'lineNumber',
    'billingSourceType',
    'description',
    'quantity',
    'uom',
    'unitPrice',
    'taxRate',
    'lineTotal'
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    invoiceId: { type: 'string', format: 'uuid' },
    lineNumber: { type: 'integer', minimum: 1 },
    billingSourceType: { type: 'string', enum: ['DELIVERY', 'MILESTONE'] },
    deliveryBillingAllocationId: { type: 'string', format: 'uuid' },
    milestoneBillingAllocationId: { type: 'string', format: 'uuid' },
    description: { type: 'string', minLength: 2, maxLength: 255 },
    quantity: { type: 'string', pattern: decimalPattern },
    uom: { type: 'string', enum: STANDARD_UOMS },
    unitPrice: { type: 'string', pattern: decimalPattern },
    taxRate: { type: 'string', pattern: decimalPattern },
    lineTotal: { type: 'string', pattern: decimalPattern }
  },
  additionalProperties: false
} as const;

export const DeliveryBillingAllocationSchema = {
  $id: 'https://iems.org/schemas/logistics-billing/delivery-billing-allocation.json',
  type: 'object',
  required: [
    'id',
    'invoiceLineId',
    'shipmentLineId',
    'salesOrderLineId',
    'billingEntitlementId',
    'billedQuantity',
    'billedAmount',
    'currency',
    'reconciledAt'
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    invoiceLineId: { type: 'string', format: 'uuid' },
    shipmentLineId: { type: 'string', format: 'uuid' },
    salesOrderLineId: { type: 'string', format: 'uuid' },
    billingEntitlementId: { type: 'string', format: 'uuid' },
    billedQuantity: { type: 'string', pattern: decimalPattern },
    billedAmount: { type: 'string', pattern: decimalPattern },
    currency: { type: 'string', enum: ISO_CURRENCIES },
    reconciledAt: { type: 'string', format: 'date-time' }
  },
  additionalProperties: false
} as const;

export const MilestoneBillingAllocationSchema = {
  $id: 'https://iems.org/schemas/logistics-billing/milestone-billing-allocation.json',
  type: 'object',
  required: [
    'id',
    'invoiceLineId',
    'salesOrderId',
    'salesOrderLineId',
    'billingEntitlementId',
    'milestoneDescription',
    'milestonePercentage',
    'billedAmount',
    'currency',
    'reconciledAt'
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    invoiceLineId: { type: 'string', format: 'uuid' },
    salesOrderId: { type: 'string', format: 'uuid' },
    salesOrderLineId: { type: 'string', format: 'uuid' },
    billingEntitlementId: { type: 'string', format: 'uuid' },
    milestoneDescription: { type: 'string', minLength: 2, maxLength: 255 },
    milestonePercentage: { type: 'string', pattern: decimalPattern },
    billedAmount: { type: 'string', pattern: decimalPattern },
    currency: { type: 'string', enum: ISO_CURRENCIES },
    reconciledAt: { type: 'string', format: 'date-time' }
  },
  additionalProperties: false
} as const;

export const PaymentAllocationSchema = {
  $id: 'https://iems.org/schemas/logistics-billing/payment-allocation.json',
  type: 'object',
  required: [
    'id',
    'invoiceId',
    'paymentReferenceNumber',
    'paymentDate',
    'paymentMethod',
    'allocatedAmount',
    'currency',
    'bankFeeAmount',
    'appliedBy'
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    invoiceId: { type: 'string', format: 'uuid' },
    paymentReferenceNumber: { type: 'string', minLength: 3, maxLength: 64 },
    paymentDate: { type: 'string', format: 'date-time' },
    paymentMethod: {
      type: 'string',
      enum: ['BANK_TRANSFER', 'CHECK', 'CASH', 'CREDIT_OFFSET']
    },
    allocatedAmount: { type: 'string', pattern: decimalPattern },
    currency: { type: 'string', enum: ISO_CURRENCIES },
    bankFeeAmount: { type: 'string', pattern: decimalPattern },
    appliedBy: { type: 'string', format: 'uuid' },
    notes: { type: 'string', maxLength: 1000 }
  },
  additionalProperties: false
} as const;

export const DepositApplicationSchema = {
  $id: 'https://iems.org/schemas/logistics-billing/deposit-application.json',
  type: 'object',
  required: [
    'id',
    'finalInvoiceId',
    'depositInvoiceId',
    'prepaymentReference',
    'appliedDepositAmount',
    'currency',
    'appliedAt',
    'approvedBy'
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    finalInvoiceId: { type: 'string', format: 'uuid' },
    depositInvoiceId: { type: 'string', format: 'uuid' },
    prepaymentReference: { type: 'string', minLength: 3, maxLength: 64 },
    appliedDepositAmount: { type: 'string', pattern: decimalPattern },
    currency: { type: 'string', enum: ISO_CURRENCIES },
    appliedAt: { type: 'string', format: 'date-time' },
    approvedBy: { type: 'string', format: 'uuid' }
  },
  additionalProperties: false
} as const;
