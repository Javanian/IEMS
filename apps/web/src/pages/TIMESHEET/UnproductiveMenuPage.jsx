import { useNavigate } from 'react-router-dom';
import { goBackOrFallback } from '../../utils/navigation';
import { toast } from 'sonner';
import {
  Users,
  Coffee,
  Brush,
  GraduationCap,
  Package,
  FileWarning,
  Cpu,
  ClipboardCheck,
  HandHelping,
  Ruler,
  Wrench,
  Settings,
  UserCog,
  Zap,
  CalendarClock,
  Hourglass,
  MoreHorizontal,
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '';

const ICON_SIZE = 20;

const getTimesheetMode = (user = {}) =>
  String(user.mode || sessionStorage.getItem('timesheetMode') || 'single')
    .trim()
    .toLowerCase();

const UNPROD_ICONS = {
  1510: <Users size={ICON_SIZE} strokeWidth={1.8} />,
  1520: <Coffee size={ICON_SIZE} strokeWidth={1.8} />,
  1530: <Brush size={ICON_SIZE} strokeWidth={1.8} />,
  1540: <GraduationCap size={ICON_SIZE} strokeWidth={1.8} />,
  1550: <Package size={ICON_SIZE} strokeWidth={1.8} />,
  1560: <FileWarning size={ICON_SIZE} strokeWidth={1.8} />,
  1570: <Cpu size={ICON_SIZE} strokeWidth={1.8} />,
  1580: <ClipboardCheck size={ICON_SIZE} strokeWidth={1.8} />,
  1590: <HandHelping size={ICON_SIZE} strokeWidth={1.8} />,
  1610: <Ruler size={ICON_SIZE} strokeWidth={1.8} />,
  1620: <Wrench size={ICON_SIZE} strokeWidth={1.8} />,
  1630: <Settings size={ICON_SIZE} strokeWidth={1.8} />,
  1640: <UserCog size={ICON_SIZE} strokeWidth={1.8} />,
  1650: <Zap size={ICON_SIZE} strokeWidth={1.8} />,
  1660: <CalendarClock size={ICON_SIZE} strokeWidth={1.8} />,
  1670: <Hourglass size={ICON_SIZE} strokeWidth={1.8} />,
  1680: <MoreHorizontal size={ICON_SIZE} strokeWidth={1.8} />,
};

const UnproductiveMenuPage = () => {
  const navigate = useNavigate();

  const unprodCodes = [
    { code: '1510', label: 'BRIEFING' },
    { code: '1520', label: 'COFFEE BREAKS' },
    { code: '1530', label: 'HOUSEKEEPING' },
    { code: '1540', label: 'TRAINING' },
    { code: '1550', label: 'WAITING FOR MATERIAL' },
    { code: '1560', label: 'WAITING FOR NCR' },
    { code: '1570', label: 'WAITING FOR ENGINEERING' },
    { code: '1580', label: 'WAITING FOR INSPECTION' },
    { code: '1590', label: 'WAITING FOR HANDLING' },
    { code: '1610', label: 'JIGS & FIXTURES' },
    { code: '1620', label: 'TOOL PREPARATION' },
    { code: '1630', label: 'MAINTENANCE' },
    { code: '1640', label: 'LABOUR NECESSITY' },
    { code: '1650', label: 'MACHINE / ELECTRICITY BREAKDOWN' },
    { code: '1660', label: 'DAILY PM' },
    { code: '1670', label: 'WAITING FOR JOB' },
    { code: '1680', label: 'OTHERS' },
  ];

  const handleUnprodSelect = (code, label) => {
    const datakaryawan = JSON.parse(sessionStorage.getItem('datakaryawan'));

    if (!datakaryawan || !datakaryawan.snssb || !datakaryawan.full_name) {
      toast.error('Data karyawan tidak lengkap!');
      return;
    }

    const isMultiple = getTimesheetMode(datakaryawan) === 'multiple';
    const operation_text = `${code} ${label}`;

    toast.success(`${label} berhasil dicatat!`);
    navigate('/login-timesheet');

    const doCreate = () =>
      fetch(`${API_BASE}/timesheet/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id_unprod: code,
          serialnumber: datakaryawan.snssb,
          full_name: datakaryawan.full_name,
          operation_text: operation_text,
          workcentercode: datakaryawan.workcenter || '',
          workcenterdescription: datakaryawan.machinename || '',
        }),
      }).catch((err) => console.error('Error creating unprod entry:', err));

    if (isMultiple) {
      fetch(`${API_BASE}/timesheet/checkout-unprod`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          datakaryawan: {
            sn: datakaryawan.snssb,
            workcentercode: datakaryawan.workcenter || '',
          },
        }),
      }).finally(doCreate);
    } else {
      fetch(`${API_BASE}/timesheet/checkout`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ datakaryawan: { sn: datakaryawan.snssb } }),
      }).finally(doCreate);
    }
  };

  const handleBack = () => {
    goBackOrFallback(navigate);
  };

  const handleRefresh = () => {
    window.location.reload();
  };

  return (
    <div className="h-dvh w-screen bg-slate-50 flex flex-col overflow-hidden">
      {}
      <header
        className="flex-shrink-0 flex items-center justify-between
                         px-4 py-2.5 bg-white border-b border-slate-200 shadow-sm"
      >
        <button
          onClick={handleBack}
          className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold
                     bg-white border border-slate-200 text-slate-700
                     hover:bg-slate-50 hover:border-slate-300 transition-all duration-150
                     active:scale-95 min-h-[44px]"
        >
          Back
        </button>
        <h1 className="text-sm font-extrabold text-slate-800">Unproductive Menu</h1>
        <button
          onClick={handleRefresh}
          className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold
                     bg-white border border-slate-200 text-slate-700
                     hover:bg-slate-50 hover:border-slate-300 transition-all duration-150
                     active:scale-95 min-h-[44px]"
        >
          Refresh
        </button>
      </header>

      {}
      <main className="flex-1 min-h-0 p-2 sm:p-3">
        <div className="h-full grid grid-cols-3 landscape:grid-cols-4 gap-1.5 sm:gap-2 max-w-6xl mx-auto auto-rows-fr">
          {unprodCodes.map((item) => (
            <button
              key={item.code}
              onClick={() => handleUnprodSelect(item.code, item.label)}
              className="flex flex-col items-center justify-center gap-0.5
                         rounded-xl transition-all duration-150
                         bg-white border border-slate-200 text-slate-800
                         shadow-sm hover:shadow-md hover:border-[#00b4d8] hover:bg-[#caf0f8]
                         active:scale-95 active:bg-[#ade8f4]
                         px-1.5 py-1 min-h-0 overflow-hidden"
            >
              <div className="flex-shrink-0" style={{ color: '#0096c7' }}>
                {UNPROD_ICONS[item.code]}
              </div>
              <span className="text-[9px] sm:text-[10px] font-bold text-slate-800 leading-tight text-center break-words w-full line-clamp-2">
                {item.label}
              </span>
              <span className="text-[8px] sm:text-[9px] font-mono text-slate-400 flex-shrink-0">
                {item.code}
              </span>
            </button>
          ))}
        </div>
      </main>
    </div>
  );
};

export default UnproductiveMenuPage;
