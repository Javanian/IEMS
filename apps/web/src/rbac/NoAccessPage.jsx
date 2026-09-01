import { useNavigate } from 'react-router-dom';
import { ShieldAlert, ArrowLeft } from 'lucide-react';
import { featureLabel } from './featureRegistry';
import { useAuth } from './useAuth';

export default function NoAccessPage({ feature }) {
  const navigate = useNavigate();
  const { role } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f6f8fb] px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-red-200 bg-red-50 text-red-600">
          <ShieldAlert size={26} />
        </div>
        <h1 className="mt-4 text-lg font-black text-slate-900">Akses ditolak</h1>
        <p className="mt-1 text-sm font-semibold text-slate-500">
          Role <span className="font-extrabold text-slate-700">{role || 'tanpa role'}</span> tidak
          punya akses ke{' '}
          <span className="font-extrabold text-slate-700">{featureLabel(feature)}</span>.
        </p>
        <p className="mt-1 text-xs font-semibold text-slate-400">
          Hubungi administrator jika ini seharusnya bisa diakses.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-extrabold text-slate-700 hover:bg-slate-50"
          >
            <ArrowLeft size={16} />
            Kembali
          </button>
          <button
            type="button"
            onClick={() => navigate('/operations-hub')}
            className="inline-flex h-10 items-center rounded-lg bg-[#0096c7] px-4 text-sm font-extrabold text-white hover:bg-[#0077b6]"
          >
            Operations Hub
          </button>
        </div>
      </div>
    </div>
  );
}
