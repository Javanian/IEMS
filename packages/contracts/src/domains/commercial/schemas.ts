/**
 * Commercial Domain JSON Schemas
 */

import { ISO_CURRENCIES, STANDARD_UOMS } from '../../common/decimal.js';

const decimalPattern = '^[0-9]+(\\.[0-9]+)?$';
const signedDecimalPattern = '^-?[0-9]+(\\.[0-9]+)?$';

export const CustomerSchema = {
  $id: 'https://iems.org/schemas/commercial/customer.json',
  type: 'object',
  required: [
    'id',
    'organizationId',
    'legalEntityId',
    'customerCode',
    'name',
    'taxId',
    'paymentTermsDays',
    'currency',
    'status',
    'billingAddress',
    'shippingAddress',
    'createdAt',
    'updatedAt'
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    organizationId: { type: 'string', format: 'uuid' },
    legalEntityId: { type: 'string', format: 'uuid' },
    customerCode: { type: 'string', minLength: 2, maxLength: 32 },
    name: { type: 'string', minLength: 2, maxLength: 255 },
    taxId: { type: 'string', minLength: 3, maxLength: 64 },
    paymentTermsDays: { type: 'integer', minimum: 0, maximum: 365 },
    currency: { type: 'string', enum: ISO_CURRENCIES },
    status: { type: 'string', enum: ['ACTIVE', 'SUSPENDED', 'INACTIVE'] },
    billingAddress: { type: 'string', minLength: 5, maxLength: 500 },
    shippingAddress: { type: 'string', minLength: 5, maxLength: 500 },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  },
  additionalProperties: false
} as const;

export const InquirySchema = {
  $id: 'https://iems.org/schemas/commercial/inquiry.json',
  type: 'object',
  required: ['id', 'legalEntityId', 'plantId', 'inquiryNumber', 'customerId', 'requestedDueDate', 'status', 'createdAt', 'updatedAt'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    legalEntityId: { type: 'string', format: 'uuid' },
    plantId: { type: 'string', format: 'uuid' },
    inquiryNumber: { type: 'string', minLength: 3, maxLength: 64 },
    customerId: { type: 'string', format: 'uuid' },
    requestedDueDate: { type: 'string', format: 'date-time' },
    status: {
      type: 'string',
      enum: ['DRAFT', 'SUBMITTED', 'IN_REVIEW', 'ESTIMATED', 'QUOTED', 'CLOSED', 'CANCELLED']
    },
    notes: { type: 'string', maxLength: 2000 },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  },
  additionalProperties: false
} as const;

export const InquiryLineSchema = {
  $id: 'https://iems.org/schemas/commercial/inquiry-line.json',
  type: 'object',
  required: ['id', 'inquiryId', 'lineNumber', 'itemCode', 'description', 'requestedQuantity', 'requestedUom', 'status'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    inquiryId: { type: 'string', format: 'uuid' },
    lineNumber: { type: 'integer', minimum: 1 },
    itemCode: { type: 'string', minLength: 1, maxLength: 64 },
    description: { type: 'string', minLength: 1, maxLength: 255 },
    requestedQuantity: { type: 'string', pattern: decimalPattern },
    requestedUom: { type: 'string', enum: STANDARD_UOMS },
    targetPrice: { type: 'string', pattern: decimalPattern },
    status: { type: 'string', enum: ['OPEN', 'ESTIMATED', 'QUOTED', 'REJECTED'] }
  },
  additionalProperties: false
} as const;

export const QuotationSchema = {
  $id: 'https://iems.org/schemas/commercial/quotation.json',
  type: 'object',
  required: ['id', 'legalEntityId', 'plantId', 'quotationNumber', 'customerId', 'currency', 'status', 'createdAt', 'updatedAt'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    legalEntityId: { type: 'string', format: 'uuid' },
    plantId: { type: 'string', format: 'uuid' },
    quotationNumber: { type: 'string', minLength: 3, maxLength: 64 },
    customerId: { type: 'string', format: 'uuid' },
    inquiryId: { type: 'string', format: 'uuid' },
    currency: { type: 'string', enum: ISO_CURRENCIES },
    status: { type: 'string', enum: ['ACTIVE', 'CLOSED', 'CANCELLED'] },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  },
  additionalProperties: false
} as const;

export const QuoteRevisionSchema = {
  $id: 'https://iems.org/schemas/commercial/quote-revision.json',
  type: 'object',
  required: [
    'id',
    'quotationId',
    'revisionNumber',
    'status',
    'totalMaterialCost',
    'totalLaborCost',
    'totalMachineCost',
    'totalSubcontractCost',
    'totalOverheadCost',
    'subtotal',
    'discountPercent',
    'discountAmount',
    'totalAmount',
    'currency',
    'validityDate',
    'createdAt',
    'updatedAt'
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    quotationId: { type: 'string', format: 'uuid' },
    revisionNumber: { type: 'integer', minimum: 1 },
    status: {
      type: 'string',
      enum: ['DRAFT', 'IN_REVIEW', 'APPROVED', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'SUPERSEDED']
    },
    totalMaterialCost: { type: 'string', pattern: decimalPattern },
    totalLaborCost: { type: 'string', pattern: decimalPattern },
    totalMachineCost: { type: 'string', pattern: decimalPattern },
    totalSubcontractCost: { type: 'string', pattern: decimalPattern },
    totalOverheadCost: { type: 'string', pattern: decimalPattern },
    subtotal: { type: 'string', pattern: decimalPattern },
    discountPercent: { type: 'string', pattern: decimalPattern },
    discountAmount: { type: 'string', pattern: decimalPattern },
    totalAmount: { type: 'string', pattern: decimalPattern },
    currency: { type: 'string', enum: ISO_CURRENCIES },
    approvedBy: { type: 'string', format: 'uuid' },
    approvedAt: { type: 'string', format: 'date-time' },
    validityDate: { type: 'string', format: 'date-time' },
    rejectionReason: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  },
  additionalProperties: false
} as const;

export const QuoteLineSchema = {
  $id: 'https://iems.org/schemas/commercial/quote-line.json',
  type: 'object',
  required: [
    'id',
    'quoteRevisionId',
    'lineNumber',
    'itemCode',
    'description',
    'quantity',
    'uom',
    'unitCost',
    'unitPrice',
    'discountPercent',
    'lineTotal',
    'lineType'
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    quoteRevisionId: { type: 'string', format: 'uuid' },
    lineNumber: { type: 'integer', minimum: 1 },
    inquiryLineId: { type: 'string', format: 'uuid' },
    itemCode: { type: 'string', minLength: 1, maxLength: 64 },
    description: { type: 'string', minLength: 1, maxLength: 255 },
    quantity: { type: 'string', pattern: decimalPattern },
    uom: { type: 'string', enum: STANDARD_UOMS },
    unitCost: { type: 'string', pattern: decimalPattern },
    unitPrice: { type: 'string', pattern: decimalPattern },
    discountPercent: { type: 'string', pattern: decimalPattern },
    lineTotal: { type: 'string', pattern: decimalPattern },
    lineType: { type: 'string', enum: ['MANUFACTURE', 'REPAIR', 'SERVICE', 'MATERIAL'] }
  },
  additionalProperties: false
} as const;

export const EstimateComponentSchema = {
  $id: 'https://iems.org/schemas/commercial/estimate-component.json',
  type: 'object',
  required: ['id', 'quoteLineId', 'componentType', 'costCategory', 'calculationBasis', 'quantity', 'unitRate', 'totalCost'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    quoteLineId: { type: 'string', format: 'uuid' },
    componentType: { type: 'string', enum: ['MATERIAL', 'LABOR', 'MACHINE', 'SUBCONTRACT', 'OVERHEAD'] },
    costCategory: { type: 'string', minLength: 2, maxLength: 64 },
    calculationBasis: { type: 'string', minLength: 2, maxLength: 128 },
    quantity: { type: 'string', pattern: decimalPattern },
    unitRate: { type: 'string', pattern: decimalPattern },
    totalCost: { type: 'string', pattern: decimalPattern },
    notes: { type: 'string', maxLength: 1000 }
  },
  additionalProperties: false
} as const;

export const QuoteAcceptanceSchema = {
  $id: 'https://iems.org/schemas/commercial/quote-acceptance.json',
  type: 'object',
  required: ['id', 'quoteRevisionId', 'quoteLineId', 'acceptedQuantity', 'acceptedAmount', 'customerReference', 'acceptedAt', 'acceptedByCustomerContact'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    quoteRevisionId: { type: 'string', format: 'uuid' },
    quoteLineId: { type: 'string', format: 'uuid' },
    acceptedQuantity: { type: 'string', pattern: decimalPattern },
    acceptedAmount: { type: 'string', pattern: decimalPattern },
    customerReference: { type: 'string', minLength: 2, maxLength: 64 },
    acceptedAt: { type: 'string', format: 'date-time' },
    acceptedByCustomerContact: { type: 'string', minLength: 2, maxLength: 128 },
    notes: { type: 'string', maxLength: 1000 }
  },
  additionalProperties: false
} as const;

export const SalesOrderSchema = {
  $id: 'https://iems.org/schemas/commercial/sales-order.json',
  type: 'object',
  required: [
    'id',
    'legalEntityId',
    'fulfillmentPlantId',
    'orderNumber',
    'customerId',
    'orderMode',
    'currency',
    'subtotal',
    'taxAmount',
    'totalAmount',
    'status',
    'createdAt',
    'updatedAt',
    'version'
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    legalEntityId: { type: 'string', format: 'uuid' },
    fulfillmentPlantId: { type: 'string', format: 'uuid' },
    orderNumber: { type: 'string', minLength: 3, maxLength: 64 },
    customerId: { type: 'string', format: 'uuid' },
    quotationRevisionId: { type: 'string', format: 'uuid' },
    orderMode: { type: 'string', enum: ['MANUFACTURE', 'REPAIR', 'SERVICE'] },
    currency: { type: 'string', enum: ISO_CURRENCIES },
    subtotal: { type: 'string', pattern: decimalPattern },
    taxAmount: { type: 'string', pattern: decimalPattern },
    totalAmount: { type: 'string', pattern: decimalPattern },
    status: {
      type: 'string',
      enum: ['DRAFT', 'CONFIRMED', 'IN_EXECUTION', 'FULFILLED', 'CLOSED', 'CANCELLED']
    },
    confirmedAt: { type: 'string', format: 'date-time' },
    confirmedBy: { type: 'string', format: 'uuid' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    version: { type: 'integer', minimum: 1 }
  },
  additionalProperties: false
} as const;

export const SalesOrderLineSchema = {
  $id: 'https://iems.org/schemas/commercial/sales-order-line.json',
  type: 'object',
  required: [
    'id',
    'salesOrderId',
    'lineNumber',
    'itemCode',
    'description',
    'quantity',
    'uom',
    'unitPrice',
    'lineTotal',
    'promisedDeliveryDate',
    'fulfilledQuantity',
    'billedQuantity',
    'status'
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    salesOrderId: { type: 'string', format: 'uuid' },
    lineNumber: { type: 'integer', minimum: 1 },
    quoteLineId: { type: 'string', format: 'uuid' },
    itemCode: { type: 'string', minLength: 1, maxLength: 64 },
    description: { type: 'string', minLength: 1, maxLength: 255 },
    quantity: { type: 'string', pattern: decimalPattern },
    uom: { type: 'string', enum: STANDARD_UOMS },
    unitPrice: { type: 'string', pattern: decimalPattern },
    lineTotal: { type: 'string', pattern: decimalPattern },
    promisedDeliveryDate: { type: 'string', format: 'date-time' },
    fulfilledQuantity: { type: 'string', pattern: decimalPattern },
    billedQuantity: { type: 'string', pattern: decimalPattern },
    status: {
      type: 'string',
      enum: ['CONFIRMED', 'IN_PRODUCTION', 'PARTIALLY_FULFILLED', 'FULFILLED', 'CANCELLED']
    }
  },
  additionalProperties: false
} as const;

export const OrderAmendmentSchema = {
  $id: 'https://iems.org/schemas/commercial/order-amendment.json',
  type: 'object',
  required: [
    'id',
    'salesOrderId',
    'amendmentNumber',
    'amendmentReason',
    'requestedBy',
    'priceDelta',
    'deliveryDateDeltaDays',
    'status',
    'createdAt'
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    salesOrderId: { type: 'string', format: 'uuid' },
    amendmentNumber: { type: 'integer', minimum: 1 },
    amendmentReason: { type: 'string', minLength: 5, maxLength: 500 },
    requestedBy: { type: 'string', format: 'uuid' },
    approvedBy: { type: 'string', format: 'uuid' },
    approvedAt: { type: 'string', format: 'date-time' },
    priceDelta: { type: 'string', pattern: signedDecimalPattern },
    deliveryDateDeltaDays: { type: 'integer' },
    status: { type: 'string', enum: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED'] },
    createdAt: { type: 'string', format: 'date-time' }
  },
  additionalProperties: false
} as const;

export const BillingEntitlementSchema = {
  $id: 'https://iems.org/schemas/commercial/billing-entitlement.json',
  type: 'object',
  required: [
    'id',
    'salesOrderId',
    'salesOrderLineId',
    'entitlementMode',
    'authorizedCapAmount',
    'currency',
    'billedAmountToDate',
    'creditedAmountToDate',
    'remainingBillableAmount',
    'status',
    'createdAt',
    'updatedAt'
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    salesOrderId: { type: 'string', format: 'uuid' },
    salesOrderLineId: { type: 'string', format: 'uuid' },
    entitlementMode: { type: 'string', enum: ['DELIVERY_BASED', 'MILESTONE_BASED'] },
    authorizedCapAmount: { type: 'string', pattern: decimalPattern },
    currency: { type: 'string', enum: ISO_CURRENCIES },
    billedAmountToDate: { type: 'string', pattern: decimalPattern },
    creditedAmountToDate: { type: 'string', pattern: decimalPattern },
    remainingBillableAmount: { type: 'string', pattern: decimalPattern },
    status: { type: 'string', enum: ['ACTIVE', 'FULLY_BILLED', 'CANCELLED'] },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  },
  additionalProperties: false
} as const;
