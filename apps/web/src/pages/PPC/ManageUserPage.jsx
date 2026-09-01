import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CreditCard, KeyRound, Users } from 'lucide-react';

function readAuthUser() {
  try {
    return JSON.parse(sessionStorage.getItem('authUser') || 'null');
  } catch {
    return null;
  }
}

export default function ManageUserPage() {
  const navigate = useNavigate();
  const authUser = readAuthUser();
  const isAdministrator = String(authUser?.roles || '').toLowerCase() === 'administrator';

  return (
    <div className="min-h-screen bg-[#f6f8fb] text-slate-800">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="flex items-center justify-between gap-3 px-4 py-3 md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => navigate('/operations-hub')}
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
              aria-label="Back"
            >
              <ArrowLeft size={18} />
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-extrabold text-slate-950">Manage User</h1>
              <p className="truncate text-xs font-semibold text-slate-500">
                Pilih data user yang ingin dikelola
              </p>
            </div>
          </div>
          <Users className="h-5 w-5 text-[#0077b6]" />
        </div>
      </header>

      <main className="mx-auto grid max-w-5xl grid-cols-1 gap-4 px-4 py-5 md:grid-cols-2 md:px-6">
        <button
          type="button"
          onClick={() => navigate('/nfc-users')}
          className="group min-h-[180px] rounded-lg border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-cyan-200 hover:bg-cyan-50/40"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#e8f7fb] text-[#0077b6]">
            <CreditCard size={24} />
          </div>
          <h2 className="mt-5 text-lg font-extrabold text-slate-950">Manage NFC User</h2>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">
            Kelola kartu NFC, SN karyawan, workcenter, machine, dan role operator.
          </p>
        </button>

        <button
          type="button"
          onClick={() => {
            if (isAdministrator) navigate('/manage-users');
          }}
          disabled={!isAdministrator}
          className="group min-h-[180px] rounded-lg border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-cyan-200 hover:bg-cyan-50/40 disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:border-slate-200 disabled:hover:bg-white"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#e8f7fb] text-[#0077b6]">
            <KeyRound size={24} />
          </div>
          <h2 className="mt-5 text-lg font-extrabold text-slate-950">Users</h2>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">
            {isAdministrator
              ? 'Daftarkan username, password, dan roles untuk login admin seperti foreman atau warehouse.'
              : 'Hanya role administrator yang dapat membuka Manage Users.'}
          </p>
        </button>
      </main>
    </div>
  );
}
