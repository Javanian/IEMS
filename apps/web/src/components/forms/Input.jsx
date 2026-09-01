import React from 'react';

export const Input = ({
  type = 'text',
  value,
  onChange,
  placeholder,
  className = '',
  ...props
}) => {
  return (
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className={`
        flex-1 px-2.5 py-2 border border-gray-300 rounded-md
        text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20
        ${className}
      `}
      {...props}
    />
  );
};

export const TextArea = ({ value, onChange, placeholder, rows = 3, className = '', ...props }) => {
  return (
    <textarea
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      rows={rows}
      className={`
        w-full min-h-[44px] px-3.5 py-3 border border-gray-300 rounded-lg
        text-base leading-relaxed bg-white text-gray-900
        transition-all duration-200 resize-y
        focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20
        ${className}
      `}
      {...props}
    />
  );
};

export const SearchRow = ({
  value,
  onChange,
  placeholder = 'Cari...',
  onSearch,
  buttonText = 'Cari',
  className = '',
}) => {
  return (
    <div className={`flex gap-2.5 my-2.5 ${className}`}>
      <Input value={value} onChange={onChange} placeholder={placeholder} />
      {onSearch && (
        <button
          onClick={onSearch}
          className="px-4 py-2 bg-primary text-white rounded-md hover:bg-primary-dark"
        >
          {buttonText}
        </button>
      )}
    </div>
  );
};

export const FormRow = ({ label, children, uom, className = '' }) => {
  return (
    <div
      className={`
      flex items-center gap-2.5
      ${className}
    `}
    >
      <label className="flex-1 text-sm font-semibold text-gray-800">{label}</label>
      <div className="flex-[2]">{children}</div>
      {uom && <div className="min-w-[50px] text-right text-xs text-gray-600">{uom}</div>}
    </div>
  );
};

export const Select = ({
  value,
  onChange,
  options = [],
  placeholder,
  className = '',
  ...props
}) => {
  return (
    <select
      value={value}
      onChange={onChange}
      className={`
        w-full px-2.5 py-2 border border-gray-300 rounded-md
        text-sm bg-white focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20
        ${className}
      `}
      {...props}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((option, index) => (
        <option key={index} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
};

export default {
  Input,
  TextArea,
  SearchRow,
  FormRow,
  Select,
};
