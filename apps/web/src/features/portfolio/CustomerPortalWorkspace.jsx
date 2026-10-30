import { useContext, useEffect, useRef, useState } from 'react';
import { IdentityContext } from './PortfolioWorkspace.jsx';
import { portfolioRequest, errorMessage } from './client.mjs';
import WorkspaceField from '../../components/forms/WorkspaceField.jsx';
import WorkspaceState from '../../components/ui/WorkspaceState.jsx';

const uuidPattern = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}';
const label = value => value ? value.replaceAll('_', ' ').toLowerCase().replace(/^./, c => c.toUpperCase()) : 'Not available';
const when = value => value ? new Date(value).toLocaleString('en-US') : 'Not recorded';

export function CustomerPortalWorkspace() {
  const identity = useContext(IdentityContext);
  const [state, setState] = useState({});
  const active = useRef(null);
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1;
    active.current?.abort();
    setState({});
    return () => { generation.current += 1; active.current?.abort(); };
  }, [identity]);

  async function lookup(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const requestGeneration = ++generation.current;
    setState({ loading: true });
    try {
      const result = await portfolioRequest(`/api/portals/customers/${encodeURIComponent(values.customerId.trim())}/orders/${encodeURIComponent(values.orderNumber.trim())}`, { signal: controller.signal });
      if (requestGeneration === generation.current) setState({ data: result.data });
    } catch (error) {
      if (error.name !== 'AbortError' && requestGeneration === generation.current) setState({ error });
    }
  }

  const order = state.data;
  return <>
    <header className="pf-page-header"><h1>Customer portal</h1><p>Track a manufacturing order or repair case in your current plant.</p></header>
    <form className="pf-panel pf-form" onSubmit={lookup} aria-label="Find your order">
      <WorkspaceField name="customerId" label="Customer account ID" required pattern={uuidPattern} hint="Use the account ID provided with your portal access. Your access is checked for every lookup." />
      <WorkspaceField name="orderNumber" label="Order or repair number" required pattern="(SO|RP)-[A-Z0-9][A-Z0-9-]{0,36}" placeholder="SO-… or RP-…" />
      <button className="pf-primary" disabled={state.loading}>Check status</button>
    </form>
    {state.loading && <WorkspaceState kind="loading" title="Loading order status" />}
    {state.error && <WorkspaceState kind="error" title="Order status unavailable"><p>{errorMessage(state.error)}</p><p>Check the account and order number, then submit again.</p></WorkspaceState>}
    {!state.loading && !state.error && !order && <WorkspaceState title="Find an order"><p>Enter your customer account ID and the order or repair number from your documents.</p></WorkspaceState>}
    {order && <section className="pf-panel" aria-labelledby="customer-order-heading" aria-live="polite">
      <h2 id="customer-order-heading">{order.orderNumber}</h2>
      <dl className="pf-dl"><dt>Type</dt><dd>{label(order.kind)}</dd><dt>Current stage</dt><dd>{label(order.publicStage)}</dd><dt>Source revision</dt><dd>{order.sourceRevision}</dd><dt>Checked at</dt><dd>{when(order.asOf)}</dd><dt>Coverage</dt><dd>{label(order.coverage)}</dd></dl>
      {order.coverage !== 'COMPLETE' && <WorkspaceState title="Status coverage is incomplete"><p>Some related records are outside this response. Contact customer service for the full status.</p></WorkspaceState>}
      <h3>Confirmed dates</h3>
      {Object.keys(order.confirmedDates || {}).length ? <dl className="pf-dl">{Object.entries(order.confirmedDates).map(([name, date]) => <div key={name}><dt>{label(name)}</dt><dd>{when(date)}</dd></div>)}</dl> : <p>No confirmed dates recorded.</p>}
      <h3>Shipments</h3>
      {!order.shipments?.length ? <p>No shipment records in this response.</p> : <ul className="pf-list">{order.shipments.map(shipment => <li key={shipment.shipmentId}><strong>Order line {shipment.lineIndex + 1}</strong><span>{shipment.quantity} {shipment.uom} · shipped {when(shipment.shippedAt)}</span><details><summary>Shipment reference</summary><p className="pf-id">{shipment.shipmentId}</p></details></li>)}</ul>}
    </section>}
  </>;
}
