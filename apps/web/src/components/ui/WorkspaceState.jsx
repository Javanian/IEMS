export default function WorkspaceState({ title, children, kind = 'empty', action }) {
  return <div className={`pf-state pf-state-${kind}`} role={kind === 'error' ? 'alert' : kind === 'loading' || kind === 'success' ? 'status' : undefined}>
    {title && <p className="pf-state-title">{title}</p>}
    {children && <div>{children}</div>}
    {action && <div className="pf-actions">{action}</div>}
  </div>;
}
