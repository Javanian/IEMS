// Compile-only usage check for the public contract; never executed.
import { createCustomerService, SYNTHETIC_ORDER_SOURCE } from '@iems/customer-service';
import type { CustomerPrincipal, VerifiedScope, TicketStage, OrderStatusView, OrderReader, OrderSnapshot, Page, TicketView, ThreadMessage, InboundResult, DeliveryState } from '@iems/customer-service';

declare const client: { startSession: () => unknown };
declare const db: { collection: () => unknown; command: () => unknown; listCollections: () => unknown; createCollection: () => unknown };
declare const foundation: { authorize: (scope: VerifiedScope, target: { plantId: string; action: string }) => Promise<any> };
declare const principal: CustomerPrincipal;
declare const scope: VerifiedScope;

const cs = createCustomerService({ client, db, foundation });
const status: Promise<OrderStatusView> = cs.getOrderStatusForCustomer(principal, { orderNumber: 'SO-DEMO-001' });
void status.then(s => { const live: boolean = s.liveLookup; const src: typeof SYNTHETIC_ORDER_SOURCE | 'PORTFOLIO_API_OWNED' = s.source; return [live, src]; });
const stage: TicketStage = 'WAITING_FOR_CUSTOMER';
void cs.transitionTicket(scope, { plantId: 'p', ticketId: 't', expectedVersion: 1, toStage: stage, reason: 'r', commandKey: 'k' });
// @ts-expect-error plain objects are not CustomerPrincipal
void cs.startComplaintDraft({ kind: 'CUSTOMER', tenantId: 't', customerId: 'c', bindingId: 'b', bindingVersion: 1 }, { requestKey: 'k' });
// @ts-expect-error unknown ticket stage
void cs.listTickets(scope, { plantId: 'p', stage: 'DONE' });
const reader: OrderReader = { readCustomerOrder: async ({ orderNumber }) => ({ orderNumber, publicStage: 'PRODUCTION', progress: null, source: 'PORTFOLIO_API_OWNED', sourceId: 'opaque', sourceVersion: 1, asOf: new Date() }) };
const live = createCustomerService({ client, db, foundation, orderReader: reader, orderReaderTimeoutMs: 2000, orderMaxStaleMs: 60000 });
const page: Promise<Page<TicketView>> = live.listTicketsPage(scope, { plantId: 'p', limit: 20, cursor: 'c' });
const thread: Promise<Page<ThreadMessage>> = live.getConversationThread(scope, { plantId: 'p', conversationId: 'c' });
const inbound: Promise<InboundResult> = live.handleInboundCommand(principal, { inboundKey: 'k', text: 'IEMS MENU', command: { op: 'MENU' } });
const previewed: DeliveryState = 'PREVIEWED';
void [page, thread, inbound, previewed, live.getActiveDraft(principal), live.listConversationsPage(scope, { plantId: 'p' })];
// @ts-expect-error reader snapshots must be authoritative
const bad: OrderSnapshot = { orderNumber: 'x', publicStage: 'PRODUCTION', progress: null, source: 'SYNTHETIC_FIXTURE_SNAPSHOT', sourceId: 'x', sourceVersion: 1, asOf: new Date() };
void bad;
// Wave 4f additions: trusted onboarding, simulator, metrics and the safe thread projection.
import { renderTemplate, parseInboundText } from '@iems/customer-service';
import type { BindingView, CustomerServiceMetrics, ThreadDeliveryState, OrderMilestone } from '@iems/customer-service';
const onboarded: Promise<{ binding: BindingView }> = live.createBinding(scope, { plantId: 'p', accountId: 'a', contactId: 'c', channel: 'SIMULATED', address: '+62000123456', idempotencyKey: 'key-0001' });
// @ts-expect-error only the simulated channel can be onboarded in this wave
void live.createBinding(scope, { plantId: 'p', accountId: 'a', contactId: 'c', channel: 'WHATSAPP', address: '+62000123456', idempotencyKey: 'key-0001' });
const metrics: Promise<CustomerServiceMetrics> = live.getMetrics(scope, { plantId: 'p', from: new Date(0), to: new Date() });
const body: string | null = renderTemplate({ template: 'menu' });
const parsed = parseInboundText('IEMS ORDER SO-1');
const state: ThreadDeliveryState = 'READ';
const milestone: OrderMilestone = { code: 'ACCEPTED', label: 'Order accepted', at: null, state: 'CURRENT' };
void [onboarded, metrics, body, parsed, state, milestone, live.simulateInbound(scope, { plantId: 'p', bindingId: 'b', inboundKey: 'k', text: 'IEMS MENU' })];
