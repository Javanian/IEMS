import React from 'react';

export const MachineCard = ({ title, details = [], onClick, className = '' }) => {
  return (
    <div
      onClick={onClick}
      className={`
        relative bg-white rounded-xl p-4 border border-slate-200 shadow-sm cursor-pointer
        transition-all duration-250 ease-in-out overflow-hidden
        flex flex-col gap-2
        hover:shadow-md hover:bg-brand-50
        before:content-[''] before:absolute before:top-0 before:left-0
        before:w-1.5 before:h-full before:bg-brand-600
        before:rounded-l-xl
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
      flex flex-col gap-2 p-4 bg-white rounded-xl border border-slate-300
      w-full justify-between h-full
      ${className}
    `}
    >
      {items.map((item, index) => (
        <div key={index} className="flex items-center gap-2.5">
          <div className="flex-1 font-semibold text-slate-800">{item.label}</div>
          <div className="flex-[2] bg-slate-100 px-3 py-2 rounded-md font-medium">{item.value}</div>
        </div>
      ))}
      {actions && <div className="flex justify-between gap-2.5 mt-2.5">{actions}</div>}
    </div>
  );
};

export default { MachineCard, InfoBox };
