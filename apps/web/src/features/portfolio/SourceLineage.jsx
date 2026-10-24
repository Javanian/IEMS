import { Link } from 'react-router-dom';

export function SourceLineage({ line: source }) {
  const line = source?.provenance;
  if (!line?.inquiryId) return null;
  return <div className="pf-source-lineage"><Link to={`/portfolio/inquiries/${line.inquiryId}`}>Open source inquiry</Link><p>Inquiry revision {line.inquiryRevision} · Source line {line.inquiryLineId}</p><p>Item: {line.itemCode} · Drawing: {line.drawingNumber} · Drawing revision: {line.drawingRevision}</p><p>Drawing metadata only. This is not an engineering BOM or release.</p></div>;
}
