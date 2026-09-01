import React from 'react';

export const Gallery = ({
  headers = [],
  items = [],
  onItemClick,
  selectedIndex,
  renderItem,
  className = '',
}) => {
  return (
    <div className={`flex-1 overflow-y-auto mt-1.5 ${className}`}>
      {}
      {headers.length > 0 && (
        <div className="grid gap-2 p-2 font-bold border-b-2 border-gray-300 bg-gray-100 rounded-t-md">
          {headers.map((header, index) => (
            <div
              key={index}
              className="text-center text-sm"
              style={{ gridColumn: header.span || 'span 1' }}
            >
              {header.label}
            </div>
          ))}
        </div>
      )}

      {}
      <div className="space-y-1.5">
        {items.map((item, index) => (
          <div
            key={index}
            onClick={() => onItemClick?.(item, index)}
            className={`
              grid gap-2 p-2 border border-gray-300 rounded-md mb-1.5
              bg-white cursor-pointer transition-colors duration-200
              text-base items-center min-h-[50px]
              hover:bg-[#f5f9ff]
              ${selectedIndex === index ? 'bg-[#d0e8ff]' : ''}
            `}
          >
            {renderItem
              ? renderItem(item, index)
              : Object.values(item).map((value, i) => (
                  <div key={i} className="text-center">
                    {value}
                  </div>
                ))}
          </div>
        ))}
      </div>
    </div>
  );
};

export const TimesheetTable = ({ data = [], onEdit, onDelete, className = '' }) => {
  return (
    <div className={`flex-1 overflow-y-auto ${className}`}>
      {}
      <div className="grid grid-cols-[1fr_2fr_1fr_1fr_1fr_0.8fr] gap-2 font-bold p-2 border-b-2 border-gray-300 bg-gray-100 rounded-t-md">
        <div className="text-sm text-center">Tanggal</div>
        <div className="text-sm text-center">Operasi</div>
        <div className="text-sm text-center">Check-in</div>
        <div className="text-sm text-center">Check-out</div>
        <div className="text-sm text-center">Durasi</div>
        <div className="text-sm text-center">Aksi</div>
      </div>

      {}
      {data.map((row, index) => (
        <div
          key={index}
          className="grid grid-cols-[1fr_2fr_1fr_1fr_1fr_0.8fr] gap-2 p-2 border border-gray-300 rounded-md mb-1.5 bg-white items-center text-sm hover:bg-[#f5f9ff]"
        >
          <div className="text-center">{row.date}</div>
          <div className="text-left">{row.operation}</div>
          <div className="flex flex-col items-center leading-tight">
            <span className="text-xs font-semibold text-gray-800">{row.checkinDate}</span>
            <span className="text-sm text-gray-900">{row.checkinTime}</span>
          </div>
          <div className="flex flex-col items-center leading-tight">
            <span className="text-xs font-semibold text-gray-800">{row.checkoutDate}</span>
            <span className="text-sm text-gray-900">{row.checkoutTime}</span>
          </div>
          <div className="text-center">{row.duration}</div>
          <div className="flex justify-center gap-1.5">
            {onEdit && (
              <button
                onClick={() => onEdit(row, index)}
                className="px-2.5 py-1.5 text-xs rounded-md bg-primary text-white"
              >
                Edit
              </button>
            )}
            {onDelete && (
              <button
                onClick={() => onDelete(row, index)}
                className="px-2.5 py-1.5 text-xs rounded-md bg-danger text-white"
              >
                Hapus
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

export const MachineGallery = ({ machines = [], onMachineClick, className = '' }) => {
  return (
    <div
      className={`
      grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))]
      gap-4 p-3 overflow-y-auto flex-1
      ${className}
    `}
    >
      {machines.map((machine, index) => (
        <div
          key={index}
          onClick={() => onMachineClick?.(machine, index)}
          className="bg-white rounded-2xl p-4 shadow-md cursor-pointer transition-all duration-250 relative overflow-hidden flex flex-col gap-2 hover:-translate-y-1 hover:shadow-xl hover:bg-[#f9fbff] before:content-[''] before:absolute before:top-0 before:left-0 before:w-1.5 before:h-full before:bg-gradient-to-b before:from-primary before:to-cyan-500 before:rounded-l-2xl"
        >
          <div className="text-lg font-bold text-primary mb-1">{machine.code || machine.name}</div>
          {Object.entries(machine).map(
            ([key, value]) =>
              key !== 'code' &&
              key !== 'name' && (
                <div key={key} className="text-sm text-gray-700 flex">
                  <span className="font-semibold text-gray-800 mr-2 min-w-[100px]">{key}:</span>
                  <span className="text-gray-600 font-medium">{value}</span>
                </div>
              )
          )}
        </div>
      ))}
    </div>
  );
};

export const TextBox = ({ children, variant = 'default', className = '' }) => {
  const variants = {
    default: '',
    order: 'border-primary max-w-[150px]',
    seq: 'border-success max-w-[50px]',
    hrs: 'border-warning max-w-[70px] min-w-[70px]',
    act: 'border-danger',
    wct: 'border-[#079949] max-w-[75px] text-xs',
  };

  return (
    <div
      className={`
      text-center w-full flex justify-center items-center
      px-2.5 py-2 bg-white border border-gray-300 rounded-lg
      text-xs font-medium text-gray-800 flex-none min-h-[45px]
      shadow-sm
      ${variants[variant]}
      ${className}
    `}
    >
      {children}
    </div>
  );
};

export default {
  Gallery,
  TimesheetTable,
  MachineGallery,
  TextBox,
};
