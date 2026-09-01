import React, { useState, useEffect } from 'react';

const PasswordPrompt = ({ children, password = '12345' }) => {
  const [inputPassword, setInputPassword] = useState('');
  const [error, setError] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    const authStatus = sessionStorage.getItem('nfcAdminAuth');
    if (authStatus === 'true') {
      setIsAuthenticated(true);
    }
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();

    if (inputPassword === password) {
      sessionStorage.setItem('nfcAdminAuth', 'true');
      setIsAuthenticated(true);
      setError('');
      setInputPassword('');
    } else {
      setError('❌ Password salah, coba lagi');
      setInputPassword('');

      setTimeout(() => {
        setError('');
      }, 3000);
    }
  };

  if (isAuthenticated) {
    return <>{children}</>;
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl p-6 w-full max-w-md">
        {}
        <div className="mb-6 text-center">
          <div className="w-16 h-16 bg-blue-900 rounded-full flex items-center justify-center mx-auto mb-3">
            <svg
              className="w-8 h-8 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-blue-900">Protected Area</h2>
          <p className="text-sm text-gray-600 mt-1">
            Masukkan password untuk mengakses halaman ini
          </p>
        </div>

        {}
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm font-medium text-blue-900 mb-2">Password</label>
            <input
              type="password"
              value={inputPassword}
              onChange={(e) => setInputPassword(e.target.value)}
              className="w-full px-4 py-3 text-sm bg-white border border-blue-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Masukkan password"
              autoFocus
            />
          </div>

          {}
          {error && (
            <div className="mb-4 p-3 bg-red-100 border border-red-300 rounded-lg">
              <p className="text-sm text-red-800 font-medium">{error}</p>
            </div>
          )}

          {}
          <button
            type="submit"
            className="w-full px-4 py-3 text-sm font-bold bg-gradient-to-b from-orange-500 to-orange-600 text-white rounded-lg shadow-md hover:from-orange-600 hover:to-orange-700 transition-all"
          >
            🔓 Unlock
          </button>
        </form>

        {}
        <div className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
          <p className="text-xs text-blue-900 text-center">
            ℹ️ Halaman ini dilindungi untuk keamanan data NFC user
          </p>
        </div>
      </div>
    </div>
  );
};

export default PasswordPrompt;
