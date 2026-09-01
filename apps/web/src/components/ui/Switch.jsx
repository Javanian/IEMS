import React from 'react';

const Switch = ({ checked = false, onChange, label, className = '' }) => {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <label className="relative inline-block w-10 h-5">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange?.(e.target.checked)}
          className="hidden"
        />
        <span
          className={`
            absolute cursor-pointer inset-0 rounded-full transition-all duration-300
            ${checked ? 'bg-primary' : 'bg-gray-300'}
            before:content-[''] before:absolute before:h-3.5 before:w-3.5
            before:left-0.5 before:bottom-0.5 before:bg-white before:rounded-full
            before:transition-transform before:duration-300
            ${checked ? 'before:translate-x-5' : 'before:translate-x-0'}
          `}
        />
      </label>
      {label && <span className="text-sm">{label}</span>}
    </div>
  );
};

export default Switch;
