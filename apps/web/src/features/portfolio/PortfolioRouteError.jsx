import { useEffect } from 'react';
import { useRouteError } from 'react-router-dom';
import './portfolio.css';

export default function PortfolioRouteError() {
  const error = useRouteError();
  useEffect(() => { console.error('Portfolio workspace failed to load.', error); }, [error]);

  return <div className="portfolio-root pf-route-recovery" data-portfolio-route-error>
    <main className="pf-main">
      <section className="pf-panel" aria-labelledby="portfolio-recovery-heading">
        <h1 id="portfolio-recovery-heading">Workspace could not load</h1>
        <p role="alert">Check your connection, then reload this page.</p>
        <div className="pf-actions"><button type="button" className="pf-primary" onClick={() => window.location.reload()}>Reload workspace</button></div>
        <details><summary>Technical details</summary><p>Code: PORTFOLIO_WORKSPACE_LOAD_FAILED</p></details>
      </section>
    </main>
  </div>;
}
