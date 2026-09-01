import React from 'react';

export default function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-6 py-12">
      {Icon && <Icon className="h-10 w-10 text-slate-300 mb-3" strokeWidth={1.5} />}
      {title && <p className="text-sm font-semibold text-slate-700">{title}</p>}
      {description && <p className="mt-1 text-xs text-slate-500 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
