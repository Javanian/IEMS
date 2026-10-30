import { useId } from 'react';
import WorkspaceState from '../ui/WorkspaceState.jsx';

export default function WorkspaceTable({ caption, columns, rows, rowKey, loading = false, error, retry, empty = 'No records match the current selection.' }) {
  const hint = useId();
  if (loading) return <WorkspaceState kind="loading" title="Loading current records..." />;
  if (error) return <WorkspaceState kind="error" title="Records could not load" action={retry && <button type="button" onClick={retry}>Refresh records</button>}><p>{error}</p></WorkspaceState>;
  if (!rows.length) return <WorkspaceState title={empty} />;
  return <><p id={hint} className="pf-table-hint">Scroll within the table to view every column.</p>
    <div className="pf-table-wrap pf-workspace-table" role="region" aria-label={caption} aria-describedby={hint} tabIndex={0}>
      <table className="pf-balance"><caption>{caption}</caption><thead><tr>{columns.map(column => <th scope="col" key={column.key} className={column.numeric ? 'pf-num' : undefined}>{column.label}</th>)}</tr></thead>
        <tbody>{rows.map(row => <tr key={rowKey(row)}>{columns.map(column => <td key={column.key} className={column.numeric ? 'pf-num' : undefined}>{column.render ? column.render(row) : row[column.key]}</td>)}</tr>)}</tbody>
      </table>
    </div></>;
}
