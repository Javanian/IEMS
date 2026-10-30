import { useId } from 'react';

export default function WorkspaceField({ label, hint, error, as: controlElement = 'input', id: suppliedId, ...props }) {
  const Control = controlElement;
  const generatedId = useId();
  const id = suppliedId || generatedId;
  const describedBy = [props['aria-describedby'], hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;
  return <div className="pf-field">
    <label htmlFor={id}>{label}{props.required && <span className="pf-muted"> (required)</span>}</label>
    <Control {...props} id={id} aria-invalid={error ? true : props['aria-invalid']} aria-describedby={describedBy} />
    {hint && <p id={`${id}-hint`} className="pf-field-hint">{hint}</p>}
    {error && <p id={`${id}-error`} className="pf-field-error">{error}</p>}
  </div>;
}
