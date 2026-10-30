import { useId } from 'react';
import { Link } from 'react-router-dom';
import WorkspaceState from '../ui/WorkspaceState.jsx';

export default function RecordShell({ title, reference, status, updatedAt, nextAction, relations = [], timeline = [], children }) {
  const id = useId();
  return <article className="pf-record-shell" aria-labelledby={`${id}-title`}>
    <header className="pf-record-heading">
      <div>{reference && <p className="pf-reference">{reference}</p>}<h1 id={`${id}-title`}>{title}</h1>{status && <p className="pf-status">{status}</p>}
        {updatedAt && <p className="pf-muted">Last updated <time dateTime={updatedAt}>{new Date(updatedAt).toLocaleString()}</time></p>}
      </div>
      {nextAction && <div className="pf-next-action"><strong>Next action</strong><div>{nextAction}</div></div>}
    </header>
    {children}
    <div className="pf-columns">
      <section className="pf-panel" aria-labelledby={`${id}-relations`}><h2 id={`${id}-relations`}>Related records</h2>
        {relations.length ? <ul className="pf-list">{relations.map(item => <li key={item.id}><Link to={item.to}>{item.label}</Link>{item.description && <p className="pf-muted">{item.description}</p>}</li>)}</ul> : <WorkspaceState title="No related records" />}
      </section>
      <section className="pf-panel" aria-labelledby={`${id}-history`}><h2 id={`${id}-history`}>Timeline</h2>
        {timeline.length ? <ol className="pf-list pf-timeline">{timeline.map(item => <li key={item.id}><strong>{item.title}</strong>{item.at && <time dateTime={item.at}>{new Date(item.at).toLocaleString()}</time>}{item.description && <p>{item.description}</p>}{item.details}</li>)}</ol> : <WorkspaceState title="No history available" />}
      </section>
    </div>
  </article>;
}
