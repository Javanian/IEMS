import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Package, Wrench } from 'lucide-react';
import { toast } from 'sonner';

function readCurrentUser() {
  try {
    return JSON.parse(sessionStorage.getItem('datakaryawan') || 'null');
  } catch {
    return null;
  }
}

function RequestChoice({ icon: Icon, title, description, tone, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[150px] items-start gap-4 rounded-lg border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-cyan-300 hover:bg-cyan-50/40 active:scale-[0.99]"
    >
      <span
        className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg ${tone}`}
      >
        <Icon size={24} />
      </span>
      <span className="min-w-0">
        <span className="block text-lg font-black uppercase tracking-normal text-slate-950">
          {title}
        </span>
        <span className="mt-2 block text-sm font-semibold leading-relaxed text-slate-500">
          {description}
        </span>
      </span>
    </button>
  );
}

export default function ToolsRequestHubPage() {
  const navigate = useNavigate();
  const [user] = useState(readCurrentUser);

  useEffect(() => {
    if (!user?.snssb) {
      toast.error('Data karyawan tidak ditemukan. Silakan login ulang.');
      navigate('/login-timesheet', { replace: true });
    }
  }, [navigate, user]);

  if (!user?.snssb) return null;

  return (
    <div className="min-h-screen bg-[#f6f8fb] text-slate-800">
      <header className="border-b border-slate-200 bg-white">
        <div className="flex items-center gap-3 px-4 py-3 md:px-6">
          <button
            type="button"
            onClick={() => navigate('/login-timesheet')}
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
            aria-label="Back"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-extrabold text-slate-950">
              Tools and Consumable Request
            </h1>
            <p className="truncate text-xs font-semibold text-slate-500">
              {user.full_name || '-'} | {user.snssb || '-'} | NFC {user.nfcid || '-'}
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-5xl gap-4 px-4 py-5 md:grid-cols-2 md:px-6">
        <RequestChoice
          icon={Wrench}
          title="Tools Request"
          description="Ajukan peminjaman tools, lihat tools yang sedang Anda pinjam, dan proses handover ke user lapangan lain."
          tone="bg-cyan-50 text-[#0077b6]"
          onClick={() => navigate('/tools-request')}
        />
        <RequestChoice
          icon={Package}
          title="Consumable Request"
          description="Ajukan permintaan consumable dan material seperti flow yang sudah berjalan."
          tone="bg-emerald-50 text-emerald-700"
          onClick={() => navigate('/consumable-request')}
        />
      </main>
    </div>
  );
}
