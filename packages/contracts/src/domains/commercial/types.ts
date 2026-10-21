/**
 * Commercial Domain Types
 *
 * Covers Inquiries, Cost Estimating, Quotations, Customer Acceptances,
 * Sales Orders, Order Amendments, and Billing Entitlements.
 * All monetary amounts and quantities are exact Decimal strings.
 */

import type { DecimalString, SignedDecimalString, CurrencyCode, UnitOfMeasure } from '../../common/decimal.js';

export interface Customer {
  id: string;
  organizationId: string;
  legalEntityId: string;
  customerCode: string;
  name: string;
  taxId: string;
  paymentTermsDays: number;
  currency: CurrencyCode;
  status: 'ACTIVE' | 'SUSPENDED' | 'INACTIVE';
  billingAddress: string;
  shippingAddress: string;
  createdAt: string;
  updatedAt: string;
}

export type InquiryStatus = 'DRAFT' | 'SUBMITTED' | 'IN_REVIEW' | 'ESTIMATED' | 'QUOTED' | 'CLOSED' | 'CANCELLED';

export interface Inquiry {
  id: string;
  legalEntityId: string;
  plantId: string;
  inquiryNumber: string;
  customerId: string;
  requestedDueDate: string;
  status: InquiryStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InquiryLine {
  id: string;
  inquiryId: string;
  lineNumber: number;
  itemCode: string;
  description: string;
  requestedQuantity: DecimalString;
  requestedUom: UnitOfMeasure;
  targetPrice?: DecimalString;
  status: 'OPEN' | 'ESTIMATED' | 'QUOTED' | 'REJECTED';
}

export interface Quotation {
  id: string;
  legalEntityId: string;
  plantId: string;
  quotationNumber: string;
  customerId: string;
  inquiryId?: string;
  currency: CurrencyCode;
  status: 'ACTIVE' | 'CLOSED' | 'CANCELLED';
  createdAt: string;
  updatedAt: string;
}

export type QuoteRevisionStatus =
  | 'DRAFT'
  | 'IN_REVIEW'
  | 'APPROVED'
  | 'SENT'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'SUPERSEDED';

export interface QuoteRevision {
  id: string;
  quotationId: string;
  revisionNumber: number;
  status: QuoteRevisionStatus;
  totalMaterialCost: DecimalString;
  totalLaborCost: DecimalString;
  totalMachineCost: DecimalString;
  totalSubcontractCost: DecimalString;
  totalOverheadCost: DecimalString;
  subtotal: DecimalString;
  discountPercent: DecimalString;
  discountAmount: DecimalString;
  totalAmount: DecimalString;
  currency: CurrencyCode;
  approvedBy?: string;
  approvedAt?: string;
  validityDate: string;
  rejectionReason?: string;
  createdAt: string;
  updatedAt: string;
}

export type QuoteLineType = 'MANUFACTURE' | 'REPAIR' | 'SERVICE' | 'MATERIAL';

export interface QuoteLine {
  id: string;
  quoteRevisionId: string;
  lineNumber: number;
  inquiryLineId?: string;
  itemCode: string;
  description: string;
  quantity: DecimalString;
  uom: UnitOfMeasure;
  unitCost: DecimalString;
  unitPrice: DecimalString;
  discountPercent: DecimalString;
  lineTotal: DecimalString;
  lineType: QuoteLineType;
}

export type EstimateComponentType = 'MATERIAL' | 'LABOR' | 'MACHINE' | 'SUBCONTRACT' | 'OVERHEAD';

export interface EstimateComponent {
  id: string;
  quoteLineId: string;
  componentType: EstimateComponentType;
  costCategory: string;
  calculationBasis: string;
  quantity: DecimalString;
  unitRate: DecimalString;
  totalCost: DecimalString;
  notes?: string;
}

export interface QuoteAcceptance {
  id: string;
  quoteRevisionId: string;
  quoteLineId: string;
  acceptedQuantity: DecimalString;
  acceptedAmount: DecimalString;
  customerReference: string;
  acceptedAt: string;
  acceptedByCustomerContact: string;
  notes?: string;
}

export type OrderMode = 'MANUFACTURE' | 'REPAIR' | 'SERVICE';
export type SalesOrderStatus = 'DRAFT' | 'CONFIRMED' | 'IN_EXECUTION' | 'FULFILLED' | 'CLOSED' | 'CANCELLED';

export interface SalesOrder {
  id: string;
  legalEntityId: string;
  fulfillmentPlantId: string;
  orderNumber: string;
  customerId: string;
  quotationRevisionId?: string;
  orderMode: OrderMode;
  currency: CurrencyCode;
  subtotal: DecimalString;
  taxAmount: DecimalString;
  totalAmount: DecimalString;
  status: SalesOrderStatus;
  confirmedAt?: string;
  confirmedBy?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export type SalesOrderLineStatus = 'CONFIRMED' | 'IN_PRODUCTION' | 'PARTIALLY_FULFILLED' | 'FULFILLED' | 'CANCELLED';

export interface SalesOrderLine {
  id: string;
  salesOrderId: string;
  lineNumber: number;
  quoteLineId?: string;
  itemCode: string;
  description: string;
  quantity: DecimalString;
  uom: UnitOfMeasure;
  unitPrice: DecimalString;
  lineTotal: DecimalString;
  promisedDeliveryDate: string;
  fulfilledQuantity: DecimalString;
  billedQuantity: DecimalString;
  status: SalesOrderLineStatus;
}

export interface OrderAmendment {
  id: string;
  salesOrderId: string;
  amendmentNumber: number;
  amendmentReason: string;
  requestedBy: string;
  approvedBy?: string;
  approvedAt?: string;
  priceDelta: SignedDecimalString;
  deliveryDateDeltaDays: number;
  status: 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
  createdAt: string;
}

export type BillingEntitlementMode = 'DELIVERY_BASED' | 'MILESTONE_BASED';

export interface BillingEntitlement {
  id: string;
  salesOrderId: string;
  salesOrderLineId: string;
  entitlementMode: BillingEntitlementMode;
  authorizedCapAmount: DecimalString;
  currency: CurrencyCode;
  billedAmountToDate: DecimalString;
  creditedAmountToDate: DecimalString;
  remainingBillableAmount: DecimalString;
  status: 'ACTIVE' | 'FULLY_BILLED' | 'CANCELLED';
  createdAt: string;
  updatedAt: string;
}
