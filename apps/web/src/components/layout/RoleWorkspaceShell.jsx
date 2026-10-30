import { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';

const groups = [
  ['Sales', [
    ['Accounts', 'accounts'], ['Opportunities', 'opportunities'],
    ['Inquiries', 'inquiries'], ['Quotes', 'quotes'], ['Sales orders', 'orders'],
  ]],
  ['Supply and inventory', [
    ['Procurement', 'procurement/vendors', null, 'procurement'],
    ['Catalog procurement', 'catalog-procurement/requests', 'catalog.read', 'catalog-procurement'],
    ['Inventory items', 'inventory-master/items', 'master.read', 'inventory-master'],
    ['Warehouse', 'warehouse/receipts'], ['Stock movements', 'warehouse/movements'],
    ['Reservations', 'warehouse/reservations'], ['Bins', 'warehouse/bins'], ['Holds', 'warehouse/holds'],
  ]],
  ['Production', [
    ['Manufacturing', 'manufacturing/work-orders'], ['Engineering', 'manufacturing/engineering'],
    ['Production planning', 'manufacturing/plan'], ['Internal production', 'manufacturing/internal-production'],
    ['Internal execution', 'manufacturing/internal-execution', 'internal.execution.read'],
  ]],
  ['Delivery and finance', [
    ['Fulfillment', 'fulfillment/shipments'], ['Purchased orders', 'fulfillment/purchased-orders'],
    ['Invoices', 'fulfillment/invoices'], ['Payments', 'fulfillment/payments'],
  ]],
  ['Service and repair', [
    ['Customer service', 'service/tickets'], ['Conversations', 'service/conversations'],
    ['Service bindings', 'service/bindings'], ['Repair', 'repair/cases'],
    ['Repair invoices', 'repair/invoices'], ['Repair deposits', 'repair/deposits'],
  ]],
];

export default function RoleWorkspaceShell({ identity, kiosk, sessionActions, children }) {
  const { pathname } = useLocation();
  const menu = useRef(null);
  const main = useRef(null);
  const previousPath = useRef(pathname);
  useEffect(() => {
    if (previousPath.current !== pathname) {
      menu.current?.removeAttribute('open');
      main.current?.focus();
      previousPath.current = pathname;
    }
  }, [pathname]);
  const current = (path) => pathname === `/portfolio/${path}` || pathname.startsWith(`/portfolio/${path}/`);
  const link = ([label, path, , match = path]) => <Link key={path} to={`/portfolio/${path}`} aria-current={current(match) ? 'page' : undefined}>{label}</Link>;
  const visibleGroups = groups.map(([title, items]) => [title, items.filter(([, , permission]) => !permission || identity?.permissions?.includes(permission))]);
  return <div className="portfolio-root pf-workspace" data-kiosk={kiosk} data-authenticated={Boolean(identity)}>
    <a className="pf-skip" href="#portfolio-content">Skip to content</a>
    <header className="pf-header">
      <Link className="pf-brand" to="/portfolio/work-queue">IEMS Portfolio</Link>
      {identity && <div className="pf-session"><span className="pf-session-user">{identity.user.username}</span>{sessionActions}</div>}
    </header>
    <div className="pf-workspace-body">
      {identity && <aside className="pf-sidebar">
        <Link className="pf-queue-link" to="/portfolio/work-queue" aria-current={current('work-queue') ? 'page' : undefined}>Work queue</Link>
        <details className="pf-workspace-menu" ref={menu}>
          <summary>Workspaces</summary>
          <nav aria-label="Portfolio workspaces">{visibleGroups.filter(([, items]) => items.length).map(([title, items]) => <section className="pf-nav-group" key={title}><h2>{title}</h2>{items.map(link)}</section>)}</nav>
        </details>
      </aside>}
      <main id="portfolio-content" className="pf-main" tabIndex={-1} ref={main}>{children}</main>
    </div>
  </div>;
}
