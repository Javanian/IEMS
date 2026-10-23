import type { TenantFoundation, VerifiedScope, UUID } from '../tenant-foundation/index.d.ts';

export type { UUID, VerifiedScope };

/** Synthetic snapshots require explicit fixture opt-in. */
export declare const SYNTHETIC_ORDER_SOURCE: 'SYNTHETIC_FIXTURE_SNAPSHOT';
export type DraftStage = 'ORDER_SELECTION' | 'CATEGORY' | 'DESCRIPTION' | 'PREVIEW' | 'CONFIRMED' | 'CANCELLED';
export type ComplaintCategory = 'DELIVERY_DELAY' | 'QUALITY' | 'WRONG_ITEM' | 'INVOICE_QUESTION' | 'SAFETY_OR_DAMAGE' | 'OTHER';
export type TicketStage = 'NEW' | 'TRIAGED' | 'ASSIGNED' | 'IN_PROGRESS' | 'WAITING_FOR_CUSTOMER' | 'RESOLVED' | 'REOPENED' | 'CLOSED';
export type ConversationMode = 'BOT_ACTIVE' | 'HUMAN_PENDING' | 'HUMAN_ACTIVE' | 'PAUSED' | 'CLOSED';
export type DeliveryState = 'PREVIEWED' | 'QUEUED'  | 'SENDING' | 'SENT' | 'FAILED' | 'UNKNOWN' | 'CANCELLED';
export type OrderPublicStage = 'ACCEPTED' | 'PLANNING' | 'PRODUCTION' | 'QUALITY_INSPECTION' | 'READY_TO_SHIP' | 'PARTIALLY_SHIPPED' | 'SHIPPED' | 'DELIVERED'
  | 'RECEIVED' | 'DIAGNOSIS' | 'AWAITING_APPROVAL' | 'REPAIR' | 'TESTING' | 'READY_TO_RETURN' | 'RETURNED';
export type BotTemplate = 'menu' | 'order_status' | 'status_unavailable' | 'draft_order' | 'draft_category' | 'draft_description' | 'draft_preview' | 'validation_error' | 'draft_back' | 'draft_cancel' | 'ticket_ack' | 'ticket_status' | 'handoff_queued' | 'operator_text' | 'resolved';
export type ErrorCode = 'DENIED' | 'NOT_FOUND' | 'INVALID_INPUT' | 'INVALID_TRANSITION' | 'VERSION_CONFLICT' | 'IDEMPOTENCY_CONFLICT' | 'DRAFT_EXPIRED' | 'STALE_FENCE' | 'STATUS_UNAVAILABLE'
  | 'VALIDATION' | 'BINDING_REVOKED' | 'BINDING_CONFLICT' | 'IDEMPOTENCY_KEY_REUSED' | 'SYNTHETIC_ADDRESS_REQUIRED';
export type OrderKind = 'MANUFACTURE' | 'REPAIR';
export type MilestoneState = 'DONE' | 'CURRENT' | 'PENDING';
export interface OrderMilestone { code: string; label: string; at: Date | null; state: MilestoneState }
export interface ConfirmedDates { promisedShipDate?: Date; estimatedReturnDate?: Date }
/** Contract wave4f-v1 delivery states. DELIVERED and READ are reserved for a provider receipt path; PREVIEWED never implies SENT. */
export type ThreadDeliveryState = DeliveryState | 'DELIVERED' | 'READ';

export declare const DRAFT_STAGES: readonly DraftStage[];
export declare const COMPLAINT_CATEGORIES: readonly ComplaintCategory[];
export declare const TICKET_STAGES: readonly TicketStage[];
export declare const CONVERSATION_MODES: readonly ConversationMode[];
export declare const DELIVERY_STATES: readonly DeliveryState[];
export declare const ORDER_PUBLIC_STAGES: readonly OrderPublicStage[];
export declare const BOT_TEMPLATES: readonly BotTemplate[];
export declare const BINDING_CHANNELS: readonly ['SIMULATED'];
export declare const SIMULATED_CHANNEL_ACCOUNT: 'SIMULATED';
export declare const SYNTHETIC_ADDRESS: RegExp;
export declare const ORDER_KINDS: readonly OrderKind[];
export declare const MILESTONE_STATES: readonly MilestoneState[];
/** Deterministic customer-facing preview text for a stored outbox payload; null for an unknown template. */
export declare function renderTemplate(payload: unknown): string | null;
/** Same grammar as the preview bridge; leading "IEMS " optional. */
export declare function parseInboundText(text: string): InboundCommand;

export declare class CustomerServiceError extends Error {
  readonly code: ErrorCode;
  readonly status: 400 | 403 | 404 | 409 | 410 | 422 | 503;
  readonly currentVersion?: number;
}
export declare function requestHash(value: unknown): string;

declare const customerPrincipal: unique symbol;
/** Opaque, runtime-registered; copies or hand-built objects are rejected. Rechecked against binding version on every call. */
export interface CustomerPrincipal {
  readonly [customerPrincipal]: true;
  readonly kind: 'CUSTOMER';
  readonly tenantId: UUID;
  readonly customerId: UUID;
  readonly bindingId: UUID;
  readonly bindingVersion: number;
}

export interface OrderStatusView { orderNumber: string; publicStage: OrderPublicStage; progress: { released: number; total: number } | null; asOf: Date; source: typeof SYNTHETIC_ORDER_SOURCE | 'PORTFOLIO_API_OWNED'; liveLookup: boolean; sourceId?: string; sourceVersion?: number; kind?: OrderKind; milestones?: OrderMilestone[]; confirmedDates?: ConfirmedDates }
export interface DraftView { draftId: UUID; stage: DraftStage; version: number; orderNumber: string | null; category: ComplaintCategory | null; description: string | null; expiresAt: Date }
export type DraftAction =
  | { type: 'SELECT_ORDER'; orderNumber: string }
  | { type: 'GENERAL_INQUIRY' }
  | { type: 'SELECT_CATEGORY'; category: ComplaintCategory }
  | { type: 'DESCRIBE'; text: string }
  | { type: 'BACK' }
  | { type: 'CANCEL' };
export interface TicketReceipt { ticketId: UUID; ticketNumber: string }
export interface CustomerTicketView { ticketNumber: string; stage: TicketStage; category: ComplaintCategory; orderNumber: string | null; updatedAt: Date; updates: { kind: 'CREATED' | 'STAGE_CHANGED' | 'PUBLIC_UPDATE' | 'CUSTOMER_COMMENT'; stage: TicketStage; text: string | null; at: Date }[] }
export type Actor = { type: 'CUSTOMER'; customerId: UUID } | { type: 'OPERATOR'; userId: UUID } | { type: 'SYSTEM' };
export interface TicketView { ticketId: UUID; ticketNumber: string; plantId: UUID; customerId: UUID; stage: TicketStage; version: number; category: ComplaintCategory; orderNumber: string | null; orderSource: typeof SYNTHETIC_ORDER_SOURCE | 'PORTFOLIO_API_OWNED' | null; assigneeId: UUID | null; description: string; createdAt: Date; updatedAt: Date }
export interface TicketEvent { eventId: UUID; ticketId: UUID; kind: string; visibility: 'CUSTOMER'; fromStage: TicketStage | null; toStage: TicketStage; version: number; actor: Actor; reason?: string | null; text?: string; at: Date }
export interface ModeChange { conversationId: UUID; mode: ConversationMode; version: number; cancelledDeliveryIds: UUID[]; inFlightDeliveryIds: UUID[] }
export interface ConversationView { conversationId: UUID; mode: ConversationMode; version: number; assigneeId: UUID | null; activeTicketId: UUID | null; deliveries: { deliveryId: UUID; kind: string; origin: 'BOT' | 'SYSTEM' | 'OPERATOR'; state: DeliveryState; attempt: number; cancelReason: string | null; deliveryUncertain: boolean }[] }
export interface ClaimedDelivery { deliveryId: UUID; fence: number; attempt: number; kind: 'TICKET_ACK' | 'HANDOFF_ACK' | 'BOT_REPLY' | 'OPERATOR_REPLY' | 'TICKET_RESOLVED'; recipient: { channelAccountId: string; providerContactId: string }; payload: Record<string, unknown>; payloadHash: string }
type Op<T> = T & { plantId: UUID };

export interface OrderSnapshot { orderNumber: string; publicStage: OrderPublicStage; progress: {released: number; total: number} | null; source: 'PORTFOLIO_API_OWNED'; sourceId: string; sourceVersion: number; asOf: Date; kind?: OrderKind; milestones?: OrderMilestone[]; confirmedDates?: ConfirmedDates }
export interface OrderReader { readCustomerOrder(input: {tenantId: UUID; plantId: UUID; customerId: UUID; orderNumber: string}): Promise<OrderSnapshot | null> }
export interface Page<T> { items: T[]; nextCursor: string | null }
export interface ConversationSummary { conversationId: UUID; mode: ConversationMode; version: number; assigneeId: UUID | null; activeTicketId: UUID | null; customerLabel: string; lastActivityAt: Date; hasUnknownDelivery: boolean }
export interface ThreadMessage { messageId: UUID; direction: 'INBOUND' | 'OUTBOUND'; origin: 'CUSTOMER' | 'BOT' | 'SYSTEM' | 'OPERATOR'; kind: string; text: string; state: string; at: Date;
  /** Outbound only. */ body?: string | null; template?: { id: string | null; version: number }; source?: { kind: string; id: string | null; sourceVersion: number | null; asOf: Date } | null;
  deliveryState?: ThreadDeliveryState; order?: { kind: OrderKind | null; orderNumber: string; publicStage: OrderPublicStage; progress: { released: number; total: number } | null; milestones: OrderMilestone[]; confirmedDates: ConfirmedDates; sourceVersion: number | null; asOf: Date };
  cancelReason?: string; previewedAt?: Date | null; sentAt?: Date | null }
export type BindingStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED';
export interface BindingView { bindingId: UUID; accountId: UUID; contactId: UUID | null; channel: 'SIMULATED' | 'FIXTURE'; address: string | null; status: BindingStatus; version: number; expiresAt: Date | null; verifiedMethod: string; createdAt: Date; createdBy: UUID | null; revokedAt: Date | null; revokedBy: UUID | null; revokeReason: string | null }
export interface MetricSummary { n: number; p50Minutes: number; p90Minutes: number }
export interface CustomerServiceMetrics { window: { from: Date; to: Date }; open: number; unassigned: number; overdue: { count: number; slaMinutes: number }; firstHumanResponse: MetricSummary | null; resolution: MetricSummary | null; asOf: Date; truncated: boolean; definitions: Record<string, string> }
export interface PartyDirectory { verifyCustomerContact(input: { tenantId: UUID; plantId: UUID; accountId: UUID; contactId: UUID }, options: { session: unknown }): Promise<{ accountLabel?: string } | null> }
export type InboundCommand = {op: 'MENU' | 'HUMAN' | 'COMPLAINT' | 'CONFIRM' | 'UNKNOWN_COMMAND'} | {op: 'ORDER'; orderNumber: string} | {op: 'TICKET'; ticketNumber: string} | {op: 'DRAFT'; action: DraftAction};
export interface InboundResult { draft?: DraftView; ticket?: TicketReceipt | CustomerTicketView; receipt?: TicketReceipt; deliveryIds: UUID[]; reply?: {deliveryId: UUID | null; state: DeliveryState | 'SUPPRESSED'}; error?: string; mode?: ConversationMode }
export interface CustomerService {
  handleInboundCommand(principal: CustomerPrincipal, input: {inboundKey: string; text: string; command: InboundCommand}): Promise<InboundResult>;
  getActiveDraft(principal: CustomerPrincipal): Promise<DraftView | null>;
  getDraftByRequestKey(principal: CustomerPrincipal, input: {requestKey: string}): Promise<DraftView | null>;
  getDraft(principal: CustomerPrincipal, input: {draftId: UUID}): Promise<DraftView>;
  listTicketsPage(scope: VerifiedScope, input: Op<{stage?: TicketStage; assigneeId?: UUID | null; limit?: number; cursor?: string}>): Promise<Page<TicketView>>;
  listConversationsPage(scope: VerifiedScope, input: Op<{mode?: ConversationMode; limit?: number; cursor?: string}>): Promise<Page<ConversationSummary>>;
  getConversationThread(scope: VerifiedScope, input: Op<{conversationId: UUID; limit?: number; cursor?: string}>): Promise<Page<ThreadMessage>>;
  initialize(): Promise<void>;
  // Fixture/admin (requires cs.fixture.admin). Synthetic data only.
  provisionFixtureCustomer(scope: VerifiedScope, input: Op<{ customerId: UUID; label: string }>): Promise<UUID>;
  bindContact(scope: VerifiedScope, input: Op<{ bindingId: UUID; customerId: UUID; channelAccountId: string; providerContactId: string }>): Promise<UUID>;
  revokeBinding(scope: VerifiedScope, input: Op<{ bindingId: UUID; expectedVersion: number }>): Promise<{ bindingId: UUID; version: number; cancelledDeliveries: number }>;
  registerSyntheticOrderSnapshot(scope: VerifiedScope, input: Op<{ customerId: UUID; orderNumber: string; publicStage: OrderPublicStage; progress?: { released: number; total: number } | null }>): Promise<{ orderNumber: string; source: typeof SYNTHETIC_ORDER_SOURCE }>;
  // Trusted bridge port: tenantId comes from configured channel account, never message content.
  resolveCustomerPrincipal(input: { tenantId: UUID; channelAccountId: string; providerContactId: string }): Promise<CustomerPrincipal>;
  getOrderStatusForCustomer(principal: CustomerPrincipal, input: { orderNumber: string }): Promise<OrderStatusView>;
  startComplaintDraft(principal: CustomerPrincipal, input: { requestKey: string }): Promise<DraftView>;
  updateComplaintDraft(principal: CustomerPrincipal, input: { draftId: UUID; expectedVersion: number; action: DraftAction }): Promise<DraftView>;
  confirmComplaint(principal: CustomerPrincipal, input: { draftId: UUID; expectedVersion: number; inboundKey: string }): Promise<TicketReceipt>;
  getTicketForCustomer(principal: CustomerPrincipal, input: { ticketNumber: string }): Promise<CustomerTicketView>;
  addCustomerComment(principal: CustomerPrincipal, input: { ticketNumber: string; inboundKey: string; text: string }): Promise<{ eventId: UUID }>;
  enqueueBotReply(principal: CustomerPrincipal, input: { inboundKey: string; template: BotTemplate; params?: Record<string, string> }): Promise<{ deliveryId: UUID | null; state: DeliveryState | 'SUPPRESSED'; mode?: ConversationMode }>;
  requestHandoff(principal: CustomerPrincipal, input: { inboundKey: string }): Promise<ModeChange>;
  // Operator (tenant-foundation VerifiedScope + target plant action).
  getTicketForOperator(scope: VerifiedScope, input: Op<{ ticketId: UUID }>): Promise<TicketView & { history: TicketEvent[] }>;
  listTickets(scope: VerifiedScope, input: Op<{ stage?: TicketStage; assigneeId?: UUID | null; limit?: number }>): Promise<TicketView[]>;
  transitionTicket(scope: VerifiedScope, input: Op<{ ticketId: UUID; expectedVersion: number; toStage: TicketStage; reason: string; assigneeId?: UUID; commandKey: string }>): Promise<{ ticketId: UUID; stage: TicketStage; version: number }>;
  addPublicUpdate(scope: VerifiedScope, input: Op<{ ticketId: UUID; expectedVersion: number; text: string; commandKey: string }>): Promise<{ ticketId: UUID; version: number }>;
  addInternalNote(scope: VerifiedScope, input: Op<{ ticketId: UUID; text: string; commandKey: string }>): Promise<{ noteId: UUID }>;
  listInternalNotes(scope: VerifiedScope, input: Op<{ ticketId: UUID }>): Promise<{ noteId: UUID; authorUserId: UUID; text: string; at: Date }[]>;
  takeOverConversation(scope: VerifiedScope, input: Op<{ conversationId: UUID; expectedVersion: number; commandKey: string }>): Promise<ModeChange>;
  setConversationMode(scope: VerifiedScope, input: Op<{ conversationId: UUID; expectedVersion: number; toMode: 'BOT_ACTIVE' | 'PAUSED' | 'CLOSED'; reason: string; commandKey: string }>): Promise<ModeChange>;
  getConversationForOperator(scope: VerifiedScope, input: Op<{ conversationId: UUID }>): Promise<ConversationView>;
  findConversationByBinding(scope: VerifiedScope, input: Op<{ bindingId: UUID }>): Promise<{ conversationId: UUID; mode: ConversationMode; version: number }>;
  operatorReply(scope: VerifiedScope, input: Op<{ conversationId: UUID; text: string; commandKey: string }>): Promise<{ deliveryId: UUID; state: DeliveryState }>;
  resolveUnknownDelivery(scope: VerifiedScope, input: Op<{ deliveryId: UUID; resolution: 'CONFIRMED_SENT' | 'CONFIRMED_NOT_SENT_REQUEUE' | 'ABANDON'; evidence: string; providerMessageId?: string | null; commandKey: string }>): Promise<{ deliveryId: UUID; state: DeliveryState }>;
  // Trusted single-owner dispatcher port. SENDING is durable before any remote call.
  claimNextDelivery(input: { tenantId: UUID; channelAccountId: string; leaseOwner: string; leaseMs?: number; deliveryIds?: UUID[] }): Promise<ClaimedDelivery | null>;
  recordDeliveryResult(input: { tenantId: UUID; deliveryId: UUID; fence: number; outcome: 'PREVIEWED' | 'SENT' | 'NOT_SENT' | 'SUBMIT_UNCERTAIN'; providerMessageId?: string | null; error?: string | null }): Promise<{ deliveryId: UUID; state: DeliveryState }>;
  reconcileExpiredSending(input: { tenantId: UUID }): Promise<{ unknownDeliveryIds: UUID[] }>;
  // Wave 4f trusted onboarding (cs.binding.read / cs.binding.manage), simulator (cs.simulator.use), metrics (cs.ticket.read).
  createBinding(scope: VerifiedScope, input: Op<{ accountId: UUID; contactId: UUID; channel: 'SIMULATED'; address: string; expiresAt?: string | null; idempotencyKey: string }>): Promise<{ binding: BindingView }>;
  revokeBindingByOperator(scope: VerifiedScope, input: Op<{ bindingId: UUID; reason: string; expectedVersion: number; idempotencyKey: string }>): Promise<{ binding: BindingView; cancelledDeliveries: number }>;
  listBindingsPage(scope: VerifiedScope, input: Op<{ accountId?: UUID; status?: BindingStatus; limit?: number; cursor?: string }>): Promise<Page<BindingView>>;
  getOrderStatusForBinding(scope: VerifiedScope, input: Op<{ bindingId: UUID; orderNumber: string }>): Promise<Omit<OrderStatusView, 'sourceId' | 'sourceVersion' | 'kind' | 'milestones' | 'confirmedDates'> & { sourceId: string | null; sourceVersion: number | null; kind: OrderKind | null; milestones: OrderMilestone[]; confirmedDates: ConfirmedDates }>;
  simulateInbound(scope: VerifiedScope, input: Op<{ bindingId: UUID; inboundKey: string; text: string }>): Promise<{ conversationId: UUID; bindingId: UUID; command: string; result: InboundResult }>;
  getOutboundMessages(scope: VerifiedScope, input: Op<{ deliveryIds: UUID[] }>): Promise<ThreadMessage[]>;
  getMetrics(scope: VerifiedScope, input: Op<{ from: Date; to: Date }>): Promise<CustomerServiceMetrics>;
}

export declare function createCustomerService(options: {
  client: { startSession: (...args: any[]) => any };
  db: { collection: (...args: any[]) => any; command: (...args: any[]) => any; listCollections: (...args: any[]) => any; createCollection: (...args: any[]) => any };
  foundation: Pick<TenantFoundation, 'authorize'>;
  now?: () => Date;
  draftTtlMs?: number;
  ackTtlMs?: number;
  botReplyTtlMs?: number;
  maxSendAttempts?: number;
  orderReader?: OrderReader;
  orderReaderTimeoutMs?: number;
  orderMaxStaleMs?: number;
  allowSyntheticOrders?: boolean;
  previewDispatcher?: boolean;
  faultInjector?: (boundary: 'domain' | 'pointer' | 'result' | 'afterCommit' | 'bindingSnapshot') => void | Promise<void>;
  partyDirectory?: PartyDirectory | null;
  firstResponseSlaMinutes?: number;
}): CustomerService;
