import React, { createElement, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Clock3,
  Eye,
  EyeOff,
  LayoutDashboard,
  Loader2,
  Lock,
  RadioTower,
  User,
  Workflow,
} from "lucide-react";
import backdrop from "../assets/login-backdrop.svg";
import brandLogo from "../assets/brand-logo.svg";

const HIGHLIGHTS = [
  { icon: Activity, label: "Live production progress" },
  { icon: Workflow, label: "SAP sync over Kafka" },
  { icon: RadioTower, label: "Early warning system" },
];

const API_BASE = import.meta.env.VITE_API_URL || "/api";

function apiUrl(path) {
  return `${API_BASE.replace(/\/$/, "")}${path}`;
}

export default function WelcomePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [showLoginPanel, setShowLoginPanel] = useState(
    () => searchParams.get("login") === "admin",
  );
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const canSubmit = useMemo(
    () => username.trim() && password,
    [password, username],
  );

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canSubmit || loading) return;

    setLoading(true);
    setError("");

    try {
      const response = await fetch(apiUrl("/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username.trim(),
          password,
        }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || "Username atau password tidak sesuai");
      }

      sessionStorage.setItem("isVerified", "true");
      sessionStorage.setItem("authUser", JSON.stringify(payload.user));

      try {
        const permRes = await fetch(apiUrl("/auth/me/permissions"), {
          headers: {
            "x-user-id": String(payload.user?.id || ""),
            "x-user-role": payload.user?.roles || "",
          },
        });
        const permData = await permRes.json().catch(() => ({}));
        if (permData?.success && permData.permissions) {
          sessionStorage.setItem(
            "authPermissions",
            JSON.stringify(permData.permissions),
          );
        } else {
          sessionStorage.removeItem("authPermissions");
        }
      } catch {
        sessionStorage.removeItem("authPermissions");
      }
      toast.success(
        `Selamat datang, ${payload.user?.name || payload.user?.username || username.trim()}`,
      );
      navigate("/operations-hub", { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    "h-12 w-full rounded-xl border border-slate-200 bg-white px-11 text-sm font-medium text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15";

  return (
    <main className="grid min-h-dvh bg-canvas text-ink lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      {/* Brand panel, desktop only */}
      <aside className="relative hidden overflow-hidden bg-chrome lg:flex lg:flex-col">
        <img
          src={backdrop}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover opacity-90"
        />
        <div
          className="absolute inset-0 bg-gradient-to-t from-chrome via-chrome/40 to-chrome/10"
          aria-hidden="true"
        />
        <div className="relative flex items-center gap-3 px-12 pt-10">
          <img
            src={brandLogo}
            alt=""
            className="h-10 w-10 rounded-xl shadow-glow"
          />
          <div className="leading-tight">
            <p className="text-base font-bold tracking-tight text-white">
              IEMS
            </p>
            <p className="text-xs font-medium text-slate-400">
              Integrated Enterprise Management
            </p>
          </div>
        </div>

        <div className="relative mt-auto px-12 pb-12">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-slate-300 backdrop-blur">
            <span
              className="h-1.5 w-1.5 rounded-full bg-emerald-400"
              aria-hidden="true"
            />
            Plant floor to SAP, in one system
          </span>
          <h1 className="mt-5 max-w-lg text-4xl font-bold leading-[1.1] tracking-tight text-white xl:text-5xl">
            Every order, machine and shift on one screen.
          </h1>
          <p className="mt-4 max-w-md text-base leading-relaxed text-slate-400">
            Timesheets, production progress and early warnings for the shop
            floor, with confirmations streamed to SAP.
          </p>
          <ul className="mt-8 grid max-w-xl grid-cols-3 gap-3">
            {HIGHLIGHTS.map(({ icon, label }) => (
              <li
                key={label}
                className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm"
              >
                {createElement(icon, {
                  className: "h-5 w-5 text-brand-400",
                  "aria-hidden": true,
                })}
                <p className="mt-3 text-sm font-medium leading-snug text-slate-200">
                  {label}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {/* Access panel */}
      <section className="flex min-h-dvh flex-col px-5 py-8 sm:px-10">
        <div className="flex items-center gap-3 lg:hidden">
          <img src={brandLogo} alt="" className="h-9 w-9 rounded-xl" />
          <p className="text-base font-bold tracking-tight">IEMS</p>
        </div>

        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          {!showLoginPanel ? (
            <div className="animate-rise">
              <p className="text-sm font-semibold text-brand-600">
                Selamat datang
              </p>
              <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
                Pilih akses
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">
                Masuk ke timesheet operator atau login untuk membuka modul
                admin.
              </p>

              <div className="mt-8 space-y-3">
                <AccessOption
                  icon={Clock3}
                  title="Masuk Timesheet"
                  description="Operator: mulai job, pilih mesin, catat jam kerja."
                  onClick={() => navigate("/login-timesheet")}
                />
                <AccessOption
                  icon={LayoutDashboard}
                  title="Login Admin"
                  description="Planner dan admin: dashboard, order, integrasi SAP."
                  onClick={() => setShowLoginPanel(true)}
                  primary
                />
              </div>
            </div>
          ) : (
            <div className="animate-rise">
              <button
                type="button"
                onClick={() => {
                  setShowLoginPanel(false);
                  setError("");
                }}
                className="-ml-2 mb-6 inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Kembali
              </button>
              <h2 className="text-3xl font-bold tracking-tight text-slate-900">
                Login admin
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">
                Masukkan username dan password untuk membuka modul admin.
              </p>

              <form onSubmit={handleSubmit} className="mt-8 space-y-5">
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-slate-700">
                    Username
                  </span>
                  <span className="relative block">
                    <User
                      className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
                      size={18}
                      aria-hidden="true"
                    />
                    <input
                      type="text"
                      value={username}
                      onChange={(event) => {
                        setUsername(event.target.value);
                        setError("");
                      }}
                      className={inputClass}
                      placeholder="nama.pengguna"
                      autoComplete="username"
                      autoFocus
                    />
                  </span>
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-slate-700">
                    Password
                  </span>
                  <span className="relative block">
                    <Lock
                      className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
                      size={18}
                      aria-hidden="true"
                    />
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(event) => {
                        setPassword(event.target.value);
                        setError("");
                      }}
                      className={`${inputClass} pr-12`}
                      placeholder="Password"
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                      aria-label={
                        showPassword
                          ? "Sembunyikan password"
                          : "Tampilkan password"
                      }
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </span>
                </label>

                {error && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm font-medium text-red-700"
                  >
                    <AlertCircle
                      className="mt-0.5 h-4 w-4 flex-shrink-0"
                      aria-hidden="true"
                    />
                    <span>{error}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={!canSubmit || loading}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white shadow-glow transition hover:bg-brand-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
                >
                  {loading ? (
                    <Loader2
                      className="h-4 w-4 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  )}
                  Login
                </button>
              </form>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-slate-500 lg:text-left">
          IEMS · Integrated Enterprise Management System
        </p>
      </section>
    </main>
  );
}

function AccessOption({ icon, title, description, onClick, primary = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition duration-200 active:scale-[0.99] ${
        primary
          ? "border-transparent bg-brand-600 text-white shadow-glow hover:bg-brand-700"
          : "border-slate-200 bg-white text-slate-900 shadow-soft hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-lift"
      }`}
    >
      <span
        className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl ${
          primary ? "bg-white/15 text-white" : "bg-brand-50 text-brand-600"
        }`}
      >
        {createElement(icon, { className: "h-5 w-5", "aria-hidden": true })}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        <span
          className={`mt-0.5 block text-xs ${primary ? "text-brand-100" : "text-slate-500"}`}
        >
          {description}
        </span>
      </span>
      <ArrowRight
        className={`h-4 w-4 flex-shrink-0 transition-transform group-hover:translate-x-0.5 ${
          primary ? "text-white" : "text-slate-400"
        }`}
        aria-hidden="true"
      />
    </button>
  );
}
