import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { Resource, useResource } from './PortfolioWorkspace.jsx';
import { CommandForm, Input } from './FulfillmentWorkspace.jsx';
import { errorMessage } from './client.mjs';
import { deliveryLabel } from './fulfillment.mjs';
import { nextStages, stageCommand, messageLabel, inboxPath, humanize, persistedIdentity, previewView, DELIVERY_NOTES, metricsWindow, metricsPath, metricsView } from './customer-service.mjs';

const STAGES = ['NEW', 'TRIAGED', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'RESOLVED', 'REOPENED', 'CLOSED'];
export const Boundary = () => <p className="pf-tag">Synthetic data · Simulated provider · No live messages</p>;
const pageLink = (params, cursor) => { const q = new URLSearchParams(params); if (cursor) q.set('cursor', cursor); else q.delete('cursor'); return `?${q}`; };
const when = at => (at ? new Date(at).toLocaleString('en-US') : '');

export function ServiceTabs({ current }) {
  return <nav className="pf-tabs" aria-label="Customer service">
    <Link aria-current={current === 'tickets' ? 'page' : undefined} to="/portfolio/service/tickets">Tickets</Link>
    <Link aria-current={current === 'conversations' ? 'page' : undefined} to="/portfolio/service/conversations">Conversations</Link>
    <Link aria-current={current === 'bindings' ? 'page' : undefined} to="/portfolio/service/bindings">Bindings</Link>
    <Link aria-current={current === 'automation' ? 'page' : undefined} to="/portfolio/service/automation">Automation Center</Link>
  </nav>;
}

// Bounded, API-derived metrics. Nothing is computed client-side beyond formatting; null stays "No data".
function ServiceMetrics() {
  const [range, setRange] = useState(() => metricsWindow(7));
  const resource = useResource(metricsPath(range));
  const m = resource.data && typeof resource.data === 'object' ? resource.data : resource;
  return <section className="pf-panel" aria-labelledby="cs-metrics-heading" data-testid="cs-metrics" data-window-from={range.from} data-window-to={range.to}>
    <div className="pf-toolbar"><h2 id="cs-metrics-heading">Service metrics</h2>
      <label className="pf-field pf-compact">Window<select name="metricsWindow" value={range.days} onChange={e => setRange(metricsWindow(Number(e.target.value)))}><option value={1}>Last 24 hours</option><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option></select></label>
      <button type="button" onClick={() => setRange(metricsWindow(range.days))}>Reload metrics</button></div>
    {resource.loading ? <p role="status">Loading metrics...</p> : resource.error ? <div className="pf-error" role="alert"><p>Metrics unavailable. {errorMessage(resource.error)}</p>{resource.error.code && <p>Code: {resource.error.code}</p>}<button type="button" onClick={resource.reload}>Retry metrics</button></div> : <>
      <dl className="pf-metrics">{metricsView(m).map(x => <div key={x.key} className={x.empty ? 'pf-metric pf-metric-empty' : 'pf-metric'} data-metric={x.key}><dt>{x.label}</dt><dd><strong>{x.value}</strong><span>{x.detail}</span></dd></div>)}</dl>
      <p className="pf-muted">Window {when(m.window?.from ?? range.from)} to {when(m.window?.to ?? range.to)} · as of {when(m.asOf)}. Open, unassigned and overdue are current counts. Bot acknowledgements are not human responses.</p>
    </>}
  </section>;
}

export function ServiceInbox({ kind = 'tickets' }) {
  const query = new URLSearchParams(useLocation().search), cursor = query.get('cursor'), stage = query.get('stage');
  const resource = useResource(inboxPath(kind, { stage, cursor }));
  return <>
    <h1>Customer service</h1><Boundary />
    <ServiceTabs current={kind} />
    <section className="pf-panel">
      <div className="pf-toolbar"><h2>{kind === 'tickets' ? 'Ticket inbox' : 'Conversation inbox'}</h2>
        {kind === 'tickets' && <form className="pf-inline" method="get"><label className="pf-field">Stage<select name="stage" defaultValue={stage || ''}><option value="">All stages</option>{STAGES.map(s => <option key={s} value={s}>{humanize(s)}</option>)}</select></label><button>Apply filter</button></form>}
        <button type="button" onClick={resource.reload}>Refresh inbox</button></div>
      <Resource resource={resource}>{({ data, page }) => <>
        {!data.length ? <p>No {kind} in this view.</p> : <ul className="pf-list pf-rows">{data.map(row => kind === 'tickets'
          ? <li key={persistedIdentity(row, 'ticket')}><Link to={`/portfolio/service/tickets/${row.ticketId || row._id}`}>{row.ticketNumber}</Link><span className="pf-status">{humanize(row.stage)}</span><span>{humanize(row.category)} · {row.orderNumber || 'General inquiry'} · {row.assigneeId ? 'Assigned' : 'Unassigned'}</span></li>
          : <li key={persistedIdentity(row, 'conversation')}><Link to={`/portfolio/service/conversations/${row.conversationId}`}>{row.customerLabel || 'Customer conversation'}</Link><span className="pf-status">{humanize(row.mode)}</span><span>{row.assigneeId ? 'Assigned' : 'Unassigned'}{row.hasUnknownDelivery ? ' · Delivery unknown' : ''}</span></li>)}</ul>}
        <div className="pf-actions">{cursor && <Link to={pageLink(query, null)}>First page</Link>}{page?.nextCursor && <Link to={pageLink(query, page.nextCursor)}>Next page</Link>}</div>
      </>}</Resource>
    </section>
    {kind === 'tickets' && <ServiceMetrics />}
  </>;
}

function StageForm({ ticket, userId, onSaved }) {
  const next = nextStages(ticket.stage);
  if (!next.length) return null;
  return <CommandForm title="Update stage" permission="cs.ticket.write" action={`/api/cs/tickets/${ticket.ticketId}/stage`} build={(v, k) => stageCommand(ticket, v, userId, k)} onSaved={onSaved}>
    <label className="pf-field">Next stage<select name="toStage">{next.map(s => <option key={s} value={s}>{s === 'ASSIGNED' ? 'Assign to me' : humanize(s)}</option>)}</select></label>
    <Input label={next.includes('RESOLVED') ? 'Customer-visible reason or resolution' : 'Customer-visible reason'} name="reason" maxLength={500} />
  </CommandForm>;
}

export function ServiceTicket() {
  const { id } = useParams(), me = useResource('/api/session/me'), r = useResource(`/api/cs/tickets/${id}`), notes = useResource(`/api/cs/tickets/${id}/internal-notes`);
  const refresh = () => { r.reload(); notes.reload(); };
  const userId = me.data?.user?.id;
  return <><Link to="/portfolio/service/tickets">Back to tickets</Link><Resource resource={r}>{({ data: t }) => <>
    <h1>{t.ticketNumber}</h1><Boundary />
    <div className="pf-summary"><span className="pf-status">{humanize(t.stage)}</span><span>{humanize(t.category)}</span><span>{t.orderNumber || 'General inquiry'}</span><span>Assignee: {!t.assigneeId ? 'Unassigned' : t.assigneeId === userId ? 'You' : 'Another agent'}</span></div>
    <div className="pf-actions"><Link to={`/portfolio/accounts/${t.customerId}`}>Open customer account</Link>{t.conversationId && <Link to={`/portfolio/service/conversations/${t.conversationId}`}>Open conversation</Link>}<button type="button" onClick={refresh}>Refresh ticket</button></div>
    <div className="pf-columns">
      <section className="pf-panel"><h2>Ticket history</h2><p className="pf-ticket-description">{t.description}</p>
        <ol className="pf-list">{(t.history || []).map((e, index) => <li className={e.visibility === 'INTERNAL' ? 'pf-private' : undefined} key={e.eventId || e._id ? persistedIdentity(e, 'history') : `${t.ticketId}-history-${index}`}><strong>{e.visibility === 'INTERNAL' ? 'Internal' : e.visibility === 'CUSTOMER' ? 'Public' : 'Visibility not recorded'} · {e.kind === 'SLA_ESCALATED' ? 'SLA escalated' : humanize(e.kind)}</strong>{(e.text || e.reason) && <p>{e.text || e.reason}</p>}<span className="pf-muted">{e.fromStage && e.fromStage === e.toStage ? `Stage unchanged: ${humanize(e.toStage)}` : <>{e.fromStage ? `${humanize(e.fromStage)} → ` : ''}{humanize(e.toStage)}</>}</span></li>)}</ol>
        <CommandForm title="Add public update" permission="cs.ticket.write" action={`/api/cs/tickets/${id}/public-update`} build={(v, k) => ({ expectedVersion: t.version, text: v.publicText, commandKey: k })} onSaved={refresh}><label className="pf-field">Customer-visible update<textarea name="publicText" required maxLength={2000} rows={3} /></label></CommandForm>
      </section>
      <div>
        <StageForm ticket={t} userId={userId} onSaved={refresh} />
        <section className="pf-panel pf-private"><h2>Internal notes</h2><p className="pf-tag pf-tag-private">Staff only · Not visible to customer</p>
          <Resource resource={notes}>{({ data }) => !data.length ? <p>No internal notes.</p> : <ul className="pf-list">{data.map((n,index) => <li key={n.noteId || n._id ? persistedIdentity(n, 'note') : `${t.ticketId}-note-${index}`}><strong>Internal note</strong><p>{n.text}</p></li>)}</ul>}</Resource>
          <CommandForm title="Add internal note" permission="cs.note.internal" action={`/api/cs/tickets/${id}/internal-notes`} build={(v, k) => ({ text: v.internalText, commandKey: k })} onSaved={refresh}><label className="pf-field">Staff-only note<textarea name="internalText" required rows={3} maxLength={2000} /></label></CommandForm>
        </section>
      </div>
    </div>
  </>}</Resource></>;
}

// One outbound or inbound message. Outbound previews show the rendered body plus template and source provenance.
export function ThreadMessage({ m }) {
  const v = previewView(m), out = m.direction !== 'INBOUND';
  return <li className={`pf-message pf-${out ? 'out' : 'in'}`} data-delivery-state={out ? v.state : undefined}>
    <strong>{messageLabel(m)}</strong>
    {v.body ? <p className="pf-preview-body">{v.body}</p> : <p>{v.fallback}</p>}
    {out && (v.template || v.source) && <p className="pf-id pf-provenance">{v.template}{v.template && v.source ? ' · ' : ''}{v.source && <>Source: {v.source.link ? <Link to={v.source.link}>{v.source.label}</Link> : v.source.label}{v.source.version !== undefined && v.source.version !== null ? ` · v${v.source.version}` : ''}{v.source.asOf ? ` · as of ${when(v.source.asOf)}` : ''}</>}</p>}
    {out && m.order && <OrderStatus order={m.order} />}
    {out && DELIVERY_NOTES[v.state] && <p className={v.uncertain ? 'pf-delivery-note pf-uncertain' : 'pf-delivery-note'}>{DELIVERY_NOTES[v.state]}</p>}
    <time className="pf-muted" dateTime={m.at}>{new Date(m.at).toLocaleString('en-US')}</time>
  </li>;
}

// Public order or repair status carried by a source-backed reply: stage, milestones and only dates the domain stores.
function OrderStatus({ order }) {
  const dates = order.confirmedDates || {};
  return <div className="pf-order-status" data-order-kind={order.kind}>
    <p><strong>{order.kind === 'REPAIR' ? 'Repair' : 'Manufacture'} status: {humanize(order.publicStage)}</strong>{order.orderNumber ? ` · ${order.orderNumber}` : ''}</p>
    {order.milestones?.length > 0 && <ol className="pf-milestones" aria-label="Milestones">{order.milestones.map(x => <li key={x.code} data-state={x.state}><span>{x.label}</span><span className="pf-id">{x.state === 'DONE' ? `Done${x.at ? ` ${when(x.at)}` : ''}` : x.state === 'CURRENT' ? 'Current' : 'Pending'}</span></li>)}</ol>}
    {(dates.promisedShipDate || dates.estimatedReturnDate) && <p className="pf-id">{dates.promisedShipDate ? `Promised ship date ${when(dates.promisedShipDate)}` : ''}{dates.estimatedReturnDate ? `Estimated return ${when(dates.estimatedReturnDate)}` : ''}</p>}
  </div>;
}

export function ServiceConversation() {
  const { id } = useParams(), query = new URLSearchParams(useLocation().search), cursor = query.get('cursor');
  const r = useResource(`/api/cs/conversations/${id}`), thread = useResource(`/api/cs/conversations/${id}/thread?limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
  const refresh = () => { r.reload(); thread.reload(); };
  return <><Link to="/portfolio/service/conversations">Back to conversations</Link><Resource resource={r}>{({ data: c }) => <>
    <h1>Customer conversation</h1><Boundary />
    <div className="pf-summary"><span className="pf-status">{humanize(c.mode)}</span><span>{c.assigneeId ? 'Assigned' : 'Unassigned'}</span>{c.bindingId && <Link to={`/portfolio/service/bindings/${c.bindingId}`}>Open binding</Link>}</div>
    <div className="pf-actions">{c.activeTicketId && <Link to={`/portfolio/service/tickets/${c.activeTicketId}`}>Open active ticket</Link>}<button type="button" onClick={refresh}>Refresh conversation</button></div>
    <div className="pf-columns">
      <section className="pf-panel"><h2>Customer thread</h2><p className="pf-muted">Replies below are previews. Nothing is sent to WhatsApp in this workspace.</p><Resource resource={thread}>{({ data, page }) => <>
        {!data.length ? <p>No messages yet.</p> : <ol className="pf-list pf-thread">{data.map(m => <ThreadMessage key={persistedIdentity(m, 'message')} m={m} />)}</ol>}
        <div className="pf-actions">{cursor && <Link to="?">Newest page</Link>}{page?.nextCursor && <Link to={pageLink(query, page.nextCursor)}>More messages</Link>}</div>
      </>}</Resource>
        {c.mode === 'HUMAN_ACTIVE' && <CommandForm title="Reply to customer" permission="cs.reply" action={`/api/cs/conversations/${id}/reply`} build={(v, k) => ({ text: v.replyText, commandKey: k })} onSaved={refresh}><label className="pf-field">Public reply<textarea required name="replyText" rows={3} maxLength={2000} /></label><p className="pf-muted">Preview delivery only.</p></CommandForm>}
      </section>
      <div>
        {!['HUMAN_ACTIVE', 'CLOSED'].includes(c.mode) && <CommandForm title="Take over conversation" permission="cs.conversation.handoff" action={`/api/cs/conversations/${id}/takeover`} build={(_, k) => ({ expectedVersion: c.version, commandKey: k })} onSaved={refresh}><p>Pauses bot replies and assigns you.</p></CommandForm>}
        {['HUMAN_ACTIVE', 'PAUSED', 'HUMAN_PENDING'].includes(c.mode) && <CommandForm title="Resume bot" permission="cs.conversation.handoff" action={`/api/cs/conversations/${id}/mode`} build={(v, k) => ({ expectedVersion: c.version, toMode: 'BOT_ACTIVE', reason: v.reason, commandKey: k })} onSaved={refresh}><Input label="Resume reason" name="reason" maxLength={500} /></CommandForm>}
        <section className="pf-panel"><h2>Delivery status</h2><p className="pf-muted">Preview only means rendered and not sent. Unknown means the result could not be confirmed.</p>{c.deliveries?.some(d => d.state === 'QUEUED') && <CommandForm title="Preview queued replies" permission="cs.simulator.use" action="/api/cs/simulator/dispatch" build={() => ({})} onSaved={refresh}><p className="pf-muted">Runs the local preview dispatcher. Replies become Preview only; nothing is sent.</p></CommandForm>}{!c.deliveries?.length ? <p>No outbound deliveries.</p> : <ul className="pf-list">{c.deliveries.map(d => <li key={persistedIdentity(d, 'delivery')}><strong>{humanize(d.kind)}</strong><span className="pf-status">{deliveryLabel(d.state)}</span>
          {d.state === 'UNKNOWN' && <CommandForm title="Resolve delivery" permission="cs.delivery.review" action={`/api/cs/deliveries/${d.deliveryId}/resolve`} build={(v, k) => ({ resolution: v.resolution, evidence: v.evidence, commandKey: k })} onSaved={refresh}><label className="pf-field">Resolution<select name="resolution"><option value="ABANDON">Abandon</option><option value="CONFIRMED_NOT_SENT_REQUEUE">Not sent, requeue</option></select></label><Input label="Evidence" name="evidence" maxLength={1000} /></CommandForm>}</li>)}</ul>}</section>
      </div>
    </div>
  </>}</Resource></>;
}
