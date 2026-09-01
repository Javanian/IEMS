import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { loadConfig } from './config/loadConfig';

const root = createRoot(document.getElementById('root'));

loadConfig()
  .then(() => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>
    );
  })
  .catch((err) => {
    root.render(
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          textAlign: 'center',
          color: '#334155',
          background: '#f8fafc',
        }}
      >
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
            Konfigurasi plant tak tersedia
          </div>
          <div style={{ fontSize: 14, color: '#64748b' }}>{String(err?.message || err)}</div>
        </div>
      </div>
    );
  });
