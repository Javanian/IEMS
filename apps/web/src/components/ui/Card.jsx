import React from 'react';

export const MachineCard = ({ title, details = [], onClick, className = '' }) => {
  return (
    <div
      onClick={onClick}
      className={`
        relative bg-white rounded-2xl p-4 shadow-md cursor-pointer
        transition-all duration-250 ease-in-out overflow-hidden
        flex flex-col gap-2
        hover:-translate-y-1 hover:shadow-xl hover:bg-[#f9fbff]
        before:content-[''] before:absolute before:top-0 before:left-0
        before:w-1.5 before:h-full before:bg-gradient-to-b before:from-primary before:to-cyan-500
        before:rounded-l-2xl
        ${className}
      `}
    >
      <div className="text-lg font-bold text-primary mb-1">{title}</div>
      {details.map((detail, index) => (
        <div key={index} className="text-sm text-gray-700 flex">
          <span className="font-semibold text-gray-800 mr-2 min-w-[100px]">{detail.label}:</span>
          <span className="text-gray-600 font-medium">{detail.value}</span>
        </div>
      ))}
    </div>
  );
};

export const InfoBox = ({ items = [], actions, className = '' }) => {
  return (
    <div
      className={`
      flex flex-col gap-2 p-4 bg-white rounded-xl border border-gray-300
      w-full justify-between h-full
      ${className}
    `}
    >
      {items.map((item, index) => (
        <div key={index} className="flex items-center gap-2.5">
          <div className="flex-1 font-semibold text-gray-800">{item.label}</div>
          <div className="flex-[2] bg-[#f1f3f6] px-3 py-2 rounded-md font-medium">{item.value}</div>
        </div>
      ))}
      {actions && <div className="flex justify-between gap-2.5 mt-2.5">{actions}</div>}
    </div>
  );
};

export default { MachineCard, InfoBox };
