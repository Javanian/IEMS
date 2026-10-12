import React from 'react';

export const MachineCard = ({ title, details = [], onClick, className = '' }) => {
  return (
    <div
      onClick={onClick}
      className={`
        relative bg-white rounded-2xl p-4 border border-slate-200/80 shadow-soft cursor-pointer
        transition duration-200 ease-out overflow-hidden
        flex flex-col gap-2
        hover:-translate-y-0.5 hover:shadow-lift hover:border-brand-200
        before:content-[''] before:absolute before:top-0 before:left-0
        before:w-1 before:h-full before:bg-brand-600
        before:rounded-l-2xl
        ${className}
      `}
    >
      <div className="text-lg font-bold text-primary mb-1">{title}</div>
      {details.map((detail, index) => (
        <div key={index} className="text-sm text-slate-700 flex">
          <span className="font-semibold text-slate-800 mr-2 min-w-[100px]">{detail.label}:</span>
          <span className="text-slate-600 font-medium">{detail.value}</span>
        </div>
      ))}
    </div>
  );
};

export const InfoBox = ({ items = [], actions, className = '' }) => {
  return (
    <div
      className={`
      flex flex-col gap-2 p-4 bg-white rounded-2xl border border-slate-200/80 shadow-soft
      w-full justify-between h-full
      ${className}
    `}
    >
      {items.map((item, index) => (
        <div key={index} className="flex items-center gap-2.5">
          <div className="flex-1 font-semibold text-slate-800">{item.label}</div>
          <div className="flex-[2] bg-slate-50 border border-slate-200/70 px-3 py-2 rounded-lg font-medium">{item.value}</div>
        </div>
      ))}
      {actions && <div className="flex justify-between gap-2.5 mt-2.5">{actions}</div>}
    </div>
  );
};

export default { MachineCard, InfoBox };
