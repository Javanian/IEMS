import { useContext, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { portfolioRequest as request } from './client.mjs';
import { Failure, IdentityContext, Resource, useResource } from './PortfolioWorkspace.jsx';
import { finalizeInstallationCommand, installationCapability, installationHint, installationLossCommand, installationPage, installationPath, recordInstallationCommand, removeInstallationCommand } from './installation.mjs';

function InstallationCommand({ title, action, path, view, build, onSaved, blockedReason, children }) {
  const identity = useContext(IdentityContext), capability = installationCapability(action, identity?.permissions), reasonId = useId();
  const [busy, setBusy] = useState(false), [error, setError] = useState(null), attempt = useRef(null), lock = useRef(false);
  const denied = !capability.enabled ? capability.reason : error?.status === 403 ? installationCapability(action, []).reason : '';
  async function send() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try { const result = await request(path, { body:attempt.current }); attempt.current = null; onSaved(result.data); }
    catch (failure) { setError(failure); } finally { lock.current = false; setBusy(false); }
  }
  const retained = !!attempt.current, retryable = retained && error && (!error.status || error.status >= 500), hint = installationHint(error);
  return <form className="pf-panel pf-form" aria-label={title} onSubmit={event => {
    event.preventDefault(); if (attempt.current || lock.current || denied || blockedReason) return;
    const data = new FormData(event.currentTarget), values = Object.fromEntries(data);
    for (const name of ['serialUnitIds', 'lossSerialUnitIds']) if (event.currentTarget.querySelector(`[name=${name}]`)) values[name] = data.getAll(name);
    attempt.current = build(view, values, crypto.randomUUID()); send();
  }}><h3>{title}</h3><fieldset className="pf-form" disabled={busy || retained || !!denied || !!blockedReason}>{children}<label className="pf-field">Installation evidence reason<textarea name="reason" rows={3} required minLength={3} maxLength={500} /></label></fieldset>
    <Failure error={error} mutation />{hint && <p role="alert">{hint}</p>}
    {(denied || blockedReason) && <div id={reasonId}>{denied && <p className="pf-disabled-reason">{denied}</p>}{blockedReason && <p className="pf-disabled-reason">{blockedReason}</p>}</div>}
    <div className="pf-actions"><button className="pf-primary" disabled={busy || retained || !!denied || !!blockedReason} aria-describedby={denied || blockedReason ? reasonId : undefined}>{busy ? 'Saving...' : title}</button>{retryable && <button type="button" disabled={busy || !!denied} onClick={send}>Retry same installation command</button>}{retained && error && <button type="button" disabled={busy} onClick={() => { attempt.current = null; setError(null); onSaved(); }}>Discard installation command and refresh</button>}</div>
    <p className="pf-muted">After an uncertain response, the parent, identities, source versions and command key stay locked. Retry the same command or discard it and review refreshed evidence.</p>
  </form>;
}

export function InstallationWorkspace({ wo, refresh }) {
  const identity = useContext(IdentityContext), read = installationCapability('installation.read', identity?.permissions);
  if (!wo.installationRequired) return <section id="component-installation"><h2>Received component installation</h2><p>Status: UNRECORDED. Received installation was not required when this work order was planned. No parent links are inferred from lot attribution or consumption.</p></section>;
  return read.enabled ? <InstallationData wo={wo} refresh={refresh} /> : <section id="component-installation"><h2>Received component installation</h2><p className="pf-disabled-reason">{read.reason}</p></section>;
}
function InstallationData({ wo, refresh }) {
  const path = installationPath(wo._id), resource = useResource(path), saved = () => { resource.reload(); refresh(); };
  return <Resource resource={resource}>{({ data:view }) => <section id="component-installation" data-work-order-version={view.workOrderVersion} data-installation-version={view.version} data-graph-version={view.graphVersion}><h2>Received component installation</h2>
    <div className="pf-panel"><button type="button" onClick={resource.reload}>Refresh received installation</button><p>Status: {view.status} · Installation version: {view.version} · Revision: {view.currentRevision} · Graph version: {view.graphVersion}</p><p>Work order version: {view.workOrderVersion}</p><p>Operator-recorded links from received components to real outputs of this work order. Incoming inventory and claims stay CONSUMED; installation is a separate disposition. Manufactured children and general ancestry graphs are outside this record.</p>
      <K1Binding k1={view.k1} />
      {view.frozen && <><p>The first shipment froze the entire work order installation evidence.</p><p>Frozen installation revision: {view.frozen.revision}</p><p className="pf-id">Content hash: {view.frozen.contentHash}</p><Link to={`/portfolio/fulfillment/shipments/${view.frozen.firstShipmentId}`}>Open first installation shipment</Link></>}
      {!!view.blockers.length && <p>Completion blockers: {view.blockers.join(', ')}</p>}
      {!!view.sourceHolds.length && <><p role="alert">Source holds block fresh finalization and shipment. Valid historical component recording remains available.</p><ul className="pf-list">{view.sourceHolds.map(hold => <li key={hold.receiptId}><Link to={`/portfolio/warehouse/receipts/${hold.receiptId}`}>Review installation source holds on receipt {hold.receiptId}</Link><span>{hold.reasonCodes.join(', ') || 'Legacy hold requiring review'}</span></li>)}</ul></>}
      <InstallationBalances view={view} />
      <p>Incomplete parent/source requirements: {view.incompleteParents.length}. Each source identity needs exactly one active installation or explicit process-loss disposition; retired identities block finalization and new shipment.</p>
      {!!view.incompleteParents.length && <details><summary>Missing parent/source ratios ({view.incompleteParents.length})</summary><ul className="pf-list">{view.incompleteParents.map(row => <li key={`${row.outputUnitId}-${row.receiptId}`}><strong>Output {view.parents.find(parent => parent._id === row.outputUnitId)?.serial || row.outputUnitId}</strong><Link to={`/portfolio/warehouse/receipts/${row.receiptId}`}>Source receipt {row.receiptId}</Link><span>Required: {row.requiredQuantity} · Installed: {row.installedQuantity}</span></li>)}</ul></details>}
      <details><summary>Current received parent links ({view.edges.length})</summary><EdgeRows edges={view.edges} parents={view.parents} /></details>
      <details><summary>Permanent received process losses ({view.losses.length})</summary><LossRows rows={view.losses} /></details>
      <details><summary>Incoming identity dispositions ({view.components.length})</summary><ul className="pf-list">{view.components.map(component => <li key={component._id}><strong>{component.serial}</strong><span>Inventory: {component.status} · Installation disposition: {component.disposition || 'Unassigned'}</span><span className="pf-id">Identity: {component._id} · Version: {component.version} · Claim: {component.claimId}</span></li>)}</ul></details>
    </div>
    {view.status !== 'FROZEN' && ['QUARANTINED', 'QC_COMPLETED'].includes(wo.status) ? <>
      <RecordReceived key={`record-${view.version}`} view={view} path={path} onSaved={saved} />
      <RecordLoss key={`loss-${view.version}`} view={view} path={path} onSaved={saved} />
      <RemoveReceived key={`remove-${view.version}`} view={view} path={path} onSaved={saved} />
      <InstallationCommand key={`finalize-${view.version}`} title="Finalize received component installation" action="installation.finalize" path={`${path}/finalize`} view={view} build={finalizeInstallationCommand} onSaved={saved} blockedReason={view.canFinalize ? '' : `Not ready to finalize. Review current K1 binding, parent ratios, unassigned or retired identities and source holds. ${view.blockers.join(', ')}`}><p>Finalize only recorded edges and explicit loss identities against the current complete K1 evidence. No missing identity or residual quantity is assigned automatically.</p></InstallationCommand>
    </> : view.status !== 'FROZEN' && <p>Installation recording starts when final output exists. Complete QC and exact K1 evidence before finalizing.</p>}
    <InstallationHistory key={`history-${view.version}`} path={path} />
  </section>}</Resource>;
}
function K1Binding({ k1, historical = false }) {
  return <><h3>{historical ? 'K1 binding retained in this revision' : 'Current K1 lot evidence'}</h3><p>Status: {k1.status} · Revision: {k1.currentRevision} · Version: {k1.version}</p><p className="pf-id">Content hash: {k1.contentHash || 'No complete K1 binding recorded'}</p><p className="pf-id">Effective source hash: {k1.effectiveHash || 'Unavailable'}</p></>;
}
function InstallationBalances({ view }) {
  return <><h3>Received source reconciliation</h3>{!view.sources.length ? <p>No matching consumed incoming source evidence is available yet.</p> : <><p className="pf-muted">Scroll the table horizontally to compare source dispositions.</p><div className="pf-table-wrap pf-genealogy-scroll" role="region" aria-label="Received installation source quantities" tabIndex={0}><table className="pf-balance pf-genealogy-table"><thead><tr><th>Receipt lot / heat</th><th>Required per parent</th><th>Consumed</th><th>Installed</th><th>Process loss</th><th>Retired</th><th>Unassigned</th></tr></thead><tbody>{view.sources.map(source => { const balance = view.balances.find(row => row.receiptId === source.receiptId); return <tr key={source.receiptId}><td><Link to={`/portfolio/warehouse/receipts/${source.receiptId}`}>{source.materialTrace.lotNumber} / {source.materialTrace.heatNumber}</Link><p className="pf-id">Receipt: {source.receiptId}</p><p className="pf-id">Consumption: {source.movementId}</p></td><td>{source.quantityPerUnit} {source.uom}</td><td>{balance?.consumedQuantity} {source.uom}</td><td>{balance?.installedQuantity} {source.uom}</td><td>{balance?.lossQuantity} {source.uom}</td><td>{balance?.removedQuantity} {source.uom}</td><td>{balance?.unassignedQuantity} {source.uom}</td></tr>; })}</tbody></table></div></>}</>;
}
function EdgeRows({ edges, parents = [] }) {
  return !edges.length ? <p>No received parent installation edges recorded.</p> : <ul className="pf-list">{edges.map(edge => <li key={edge._id}><strong>{edge.serial} in output {parents.find(parent => parent._id === edge.outputUnitId)?.serial || edge.outputUnitId}</strong><span>Disposition: {edge.status} · Source inventory remains CONSUMED</span><span>Lot {edge.materialTrace.lotNumber} · Heat {edge.materialTrace.heatNumber} · {edge.uom}</span><Link to={`/portfolio/warehouse/receipts/${edge.receiptId}`}>Open component source receipt</Link><span className="pf-id">Edge: {edge._id} · Claim: {edge.claimId} · Consumption: {edge.movementId}</span></li>)}</ul>;
}
function LossRows({ rows }) {
  return !rows.length ? <p>No permanent received identity losses recorded.</p> : <ul className="pf-list">{rows.map(loss => <li key={loss._id}><strong>{loss.serial}</strong><span>Disposition: {loss.status} · Inventory remains CONSUMED</span><span>Lot {loss.materialTrace.lotNumber} · Heat {loss.materialTrace.heatNumber} · {loss.uom}</span><Link to={`/portfolio/warehouse/receipts/${loss.receiptId}`}>Open process-loss source receipt</Link><span className="pf-id">Identity: {loss.childId} · Claim: {loss.claimId} · Consumption: {loss.movementId}</span></li>)}</ul>;
}
const unassigned = view => view.components.filter(component => component.status === 'CONSUMED' && component.disposition === null);
function RecordReceived({ view, path, onSaved }) {
  const parents = view.parents.filter(parent => ['QUARANTINED', 'ACCEPTED', 'REJECTED'].includes(parent.status)), [parentId, setParentId] = useState(parents[0]?._id || ''), components = unassigned(view);
  return <InstallationCommand title="Record received component installation" action="installation.record" path={`${path}/record`} view={view} build={recordInstallationCommand} onSaved={onSaved} blockedReason={!parents.length ? 'No unshipped parent outputs exist for this work order.' : !components.length ? 'No unassigned consumed received identities remain.' : ''}>
    <p>Add explicit received identities to one output. This is add-only: existing edges are not replaced or cleared. Select at most 100 identities; the server validates exact released ratios and this parent's current K1 allocations. Nothing is selected automatically.</p>
    <label className="pf-field">Parent output<select name="outputUnitId" value={parentId} onChange={event => setParentId(event.target.value)} required>{parents.map(parent => <option key={parent._id} value={parent._id}>{parent.serial} · {parent.status}</option>)}</select></label>
    <label className="pf-field">Unassigned consumed received identities<select name="serialUnitIds" multiple size={Math.min(8, Math.max(3, components.length))} required defaultValue={[]}>{components.map(component => <option key={component._id} value={component._id}>{component.serial} · Lot {component.materialTrace.lotNumber} · {component.uom}</option>)}</select></label>
  </InstallationCommand>;
}
function RecordLoss({ view, path, onSaved }) {
  const components = unassigned(view);
  return <InstallationCommand title="Record received component process loss" action="installation.record" path={`${path}/losses`} view={view} build={installationLossCommand} onSaved={onSaved} blockedReason={!components.length ? 'No unassigned consumed received identities remain for explicit process-loss evidence.' : ''}>
    <p>This is permanent and add-only. Select exact identities covered by the current K1 process-loss quantities. A process-loss identity cannot later be installed, cleared or made available.</p><label className="pf-field">Received identities permanently lost in process<select name="lossSerialUnitIds" multiple size={Math.min(8, Math.max(3, components.length))} required defaultValue={[]}>{components.map(component => <option key={component._id} value={component._id}>{component.serial} · Lot {component.materialTrace.lotNumber} · {component.uom}</option>)}</select></label>
  </InstallationCommand>;
}
function RemoveReceived({ view, path, onSaved }) {
  const edges = view.edges.filter(edge => edge.status === 'ACTIVE');
  return <InstallationCommand title="Remove installed received component" action="installation.remove" path={`${path}/remove`} view={view} build={removeInstallationCommand} onSaved={onSaved} blockedReason={!edges.length ? 'No active received installation edge can be removed.' : ''}>
    <p>Permanent quarantine: removal retires this exact identity as REMOVED_QUARANTINE, leaves its parent incomplete, and blocks finalization and new shipment. The identity stays CONSUMED. No replacement, return-to-stock or reuse action exists.</p><label className="pf-field">Active installed edge to retire<select name="edgeId" required defaultValue=""><option value="">Select exact installed identity</option>{edges.map(edge => <option key={edge._id} value={edge._id}>{edge.serial} in {view.parents.find(parent => parent._id === edge.outputUnitId)?.serial || edge.outputUnitId}</option>)}</select></label>
  </InstallationCommand>;
}
function InstallationHistory({ path }) {
  const [cursor, setCursor] = useState(''), [revision, setRevision] = useState(null), resource = useResource(installationPage(`${path}/revisions`, cursor));
  return <section className="pf-panel"><h3>Immutable received installation history</h3><p>UUID page order does not imply chronology. Inspect the numbered revision for retained parent and source evidence.</p><Resource resource={resource}>{({ data, page }) => <>{!data.length ? <p>No installation revisions yet.</p> : <ul className="pf-list">{data.map(row => <li key={row._id}><button type="button" onClick={() => setRevision(row.revision)}>Inspect installation revision {row.revision}</button><span>{row.status} · {row.reason}</span><span className="pf-id">Recorded by {row.recordedBy} at {row.recordedAt}</span></li>)}</ul>}<div className="pf-actions">{cursor && <button type="button" onClick={() => setCursor('')}>First installation revision page</button>}{page.nextCursor && <button type="button" onClick={() => setCursor(page.nextCursor)}>Next installation revision page</button>}</div></>}</Resource>{revision && <InstallationRevision key={revision} path={`${path}/revisions/${revision}`} revision={revision} />}<InstallationEvents path={path} /></section>;
}
function InstallationRevision({ path, revision }) {
  const resource = useResource(path);
  return <Resource resource={resource}>{({ data }) => <section><h3>Immutable installation revision {revision}</h3><p>Status: {data.status} · {data.reason}</p><p className="pf-id">Content hash: {data.contentHash}</p>{data.k1 && <K1Binding k1={data.k1} historical />}<EdgeRows edges={data.edges} /><LossRows rows={data.losses} /></section>}</Resource>;
}
function InstallationEvents({ path }) {
  const [cursor, setCursor] = useState(''), resource = useResource(installationPage(`${path}/events`, cursor));
  return <><h3>Immutable installation events</h3><Resource resource={resource}>{({ data, page }) => <>{!data.length ? <p>No received installation events yet.</p> : <ul className="pf-list">{data.map(event => <li key={event._id}><strong>{event.kind} · Revision {event.revision} · Graph version {event.graphVersion}</strong><span>{event.reason}</span><span className="pf-id">Recorded by {event.recordedBy} at {event.recordedAt}</span><span className="pf-id">Components: {event.componentIds.join(', ')}</span></li>)}</ul>}<div className="pf-actions">{cursor && <button type="button" onClick={() => setCursor('')}>First installation event page</button>}{page.nextCursor && <button type="button" onClick={() => setCursor(page.nextCursor)}>Next installation event page</button>}</div></>}</Resource></>;
}
