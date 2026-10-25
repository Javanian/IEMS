import { AuditDetails } from './OperatorUi.jsx';
import { Link } from 'react-router-dom';

export function SourceLineage({ line: source }) {
  const line = source?.provenance;
  if (!line?.inquiryId) return null;
  return <div className="pf-source-lineage"><Link to={`/portfolio/inquiries/${line.inquiryId}`}>Open source inquiry</Link><p>Inquiry revision {line.inquiryRevision}</p><p>Item: {line.itemCode} · Drawing: {line.drawingNumber} · Drawing revision: {line.drawingRevision}</p><AuditDetails><p className="pf-id">Source line: {line.inquiryLineId}</p><p>Drawing metadata only; engineering release has separate authority.</p></AuditDetails></div>;
}
