import type { MongoClient, Db } from 'mongodb';
export type Kind = 'quote' | 'purchaseOrder' | 'invoice' | 'shipment';
export interface Scope { tenantId: string; legalEntityId: string; plantId: string }
export type Currency = 'USD' | 'EUR' | 'GBP' | 'IDR' | 'JPY' | 'KWD';
export interface Line { description: string; quantity: string; uom: string; unitPrice: string; currency: Currency; amount?: string }
export interface CommercialContent { currency: Currency; total: string; taxPolicy: 'NO_TAX'; roundingPolicy: 'LINE_HALF_UP'; lines: readonly Line[] }
export interface Source extends Scope { _id: string; version: number }
export interface QuotedSource extends Source { snapshot: CommercialContent }
export interface CumulativeRoundingProvenance { sourceId: string; lineIndex: number; beforeQuantity: string; afterQuantity: string; beforeAmount: string; afterAmount: string }
export interface CumulativeInvoiceLine extends Line { amount: string; rounding: CumulativeRoundingProvenance }
export interface CumulativeInvoiceSource extends Source { currency: Currency; total: string; taxPolicy: 'NO_TAX'; roundingPolicy: 'CUMULATIVE_HALF_UP'; lines: readonly CumulativeInvoiceLine[] }
export interface InvoiceSource extends Source, CommercialContent {}
export interface ShipmentSource extends Source { salesOrderId: string; lineIndex: number; quantity: string; uom: string; reference: string }
export interface Template { readonly id: 'iems-commercial'; readonly version: 1 | 2; readonly engine: 'pdfkit-0.17.2'; readonly layout: 'a4-flow-v1' | 'a4-flow-v2' }
export interface Snapshot { readonly schemaVersion: 1; readonly kind: Kind; readonly scope: Readonly<Scope>; readonly sourceId: string; readonly sourceVersion: number; readonly template: Template; readonly contentHash: string; readonly currency?: Currency; readonly total?: string; readonly taxPolicy?: 'NO_TAX'; readonly roundingPolicy?: 'LINE_HALF_UP' | 'CUMULATIVE_HALF_UP'; readonly salesOrderId?: string; readonly reference?: string; readonly lines: readonly Readonly<{ description: string; quantity: string; uom: string; unitPrice?: string; currency?: Currency; amount?: string; rounding?: Readonly<CumulativeRoundingProvenance> }>[] }
export const TEMPLATE: Template;
export function createSnapshot(kind: 'quote' | 'purchaseOrder', scope: Scope, source: QuotedSource, options?: { templateVersion: 1 | 2 }): Snapshot;
export function createSnapshot(kind: 'invoice', scope: Scope, source: InvoiceSource | CumulativeInvoiceSource, options?: { templateVersion: 1 | 2 }): Snapshot;
export function createSnapshot(kind: 'shipment', scope: Scope, source: ShipmentSource, options?: { templateVersion: 1 | 2 }): Snapshot;
export function contentHash(value: unknown): string;
export function renderPdf(snapshot: Snapshot): Promise<Buffer>;
export interface IssueRecord extends Scope { _id: string; kind: Kind; sourceId: string; sourceVersion: number; contentHash: string; pdfHash: string; template: Template; issuedAt: Date; snapshot: Snapshot }
export interface Issuer { issue(scope: Scope, snapshot: Snapshot): Promise<IssueRecord>; read(scope: Scope, issueId: string): Promise<{ record: IssueRecord; pdf: Buffer } | null> }
export function createIssuer(options: { client: MongoClient; db: Db }): Promise<Issuer>;
