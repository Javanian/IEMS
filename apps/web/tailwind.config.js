// Design tokens: see design-system/iems/MASTER.md. Values live as CSS variables in
// src/index.css so the palette can change without touching components.
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;
const brand = Object.fromEntries(
  [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((step) => [step, token(`brand-${step}`)])
);

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand,
        canvas: token('canvas'),
        surface: token('surface'),
        ink: token('ink'),
        chrome: token('chrome'),
        // Legacy Bootstrap-style names, remapped onto the design system.
        primary: { DEFAULT: brand[700], dark: brand[800], darker: brand[900] },
        success: { DEFAULT: '#059669', dark: '#047857', darker: '#065F46' },
        danger: { DEFAULT: '#DC2626', dark: '#B91C1C', darker: '#991B1B' },
        warning: { DEFAULT: '#F59E0B', dark: '#D97706', darker: '#B45309' },
        secondary: { DEFAULT: '#94A3B8', dark: '#64748B', darker: '#475569' },
      },
      keyframes: {
        rise: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        rise: 'rise 420ms cubic-bezier(0.16, 1, 0.3, 1) both',
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans Variable"', '"Plus Jakarta Sans"', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'Arial', 'sans-serif'],
        mono: ['"Fira Code"', 'ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
      borderRadius: {
        '4xl': '2rem',
      },
      boxShadow: {
        // Soft UI depth: a hairline plus a wide, faint ambient shadow.
        // Tailwind's own sm/md/lg follow the same soft depth so existing pages pick it up.
        sm: '0 1px 2px rgb(15 23 42 / 0.04), 0 2px 8px -2px rgb(15 23 42 / 0.06)',
        md: '0 1px 2px rgb(15 23 42 / 0.05), 0 8px 24px -6px rgb(15 23 42 / 0.12)',
        lg: '0 2px 4px rgb(15 23 42 / 0.05), 0 16px 40px -8px rgb(15 23 42 / 0.18)',
        soft: '0 1px 2px rgb(15 23 42 / 0.04), 0 4px 16px -4px rgb(15 23 42 / 0.08)',
        lift: '0 2px 4px rgb(15 23 42 / 0.05), 0 12px 32px -8px rgb(15 23 42 / 0.16)',
        glow: '0 8px 24px -6px rgb(var(--brand-600) / 0.45)',
        // The old 3D button shadows become flat, so pages that still use them match.
        '3d-primary': '0 1px 2px rgb(15 23 42 / 0.08)',
        '3d-primary-active': 'none',
        '3d-success': '0 1px 2px rgb(15 23 42 / 0.08)',
        '3d-success-active': 'none',
        '3d-danger': '0 1px 2px rgb(15 23 42 / 0.08)',
        '3d-danger-active': 'none',
        '3d-warning': '0 1px 2px rgb(15 23 42 / 0.08)',
        '3d-warning-active': 'none',
        '3d-secondary': '0 1px 2px rgb(15 23 42 / 0.08)',
        '3d-secondary-active': 'none',
      },
    },
  },
  plugins: [],
};
