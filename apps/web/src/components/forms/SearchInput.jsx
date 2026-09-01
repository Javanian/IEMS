import React from 'react';
import { Search } from 'lucide-react';

export default function SearchInput({
  value = '',
  onChange,
  placeholder = 'Search...',
  className = '',
}) {
  return (
    <div className={`relative ${className}`}>
      <Search
        size={16}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
        aria-hidden="true"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-white border border-slate-200 text-slate-800 placeholder-slate-400
                   rounded-lg pl-9 pr-3 py-2 text-sm
                   focus:outline-none focus:ring-2 focus:ring-[#00b4d8] focus:border-[#0096c7]
                   transition-all duration-150 motion-reduce:transition-none"
      />
    </div>
  );
}
