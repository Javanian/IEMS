export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#007bff',
          dark: '#0056b3',
          darker: '#004a99',
        },
        success: {
          DEFAULT: '#28a745',
          dark: '#1e7e34',
          darker: '#155724',
        },
        danger: {
          DEFAULT: '#ff6b6b',
          dark: '#c82333',
          darker: '#7a1b22',
        },
        warning: {
          DEFAULT: '#ffd966',
          dark: '#e0a800',
          darker: '#a07800',
        },
        secondary: {
          DEFAULT: '#adb5bd',
          dark: '#6c757d',
          darker: '#4a4f52',
        },
      },
      boxShadow: {
        '3d-primary': '0 4px 0 #004a99, 0 6px 12px rgba(0,0,0,0.2)',
        '3d-primary-active': '0 1px 0 #004a99, 0 3px 6px rgba(0,0,0,0.2)',
        '3d-success': '0 4px 0 #155724, 0 6px 12px rgba(0,0,0,0.2)',
        '3d-success-active': '0 1px 0 #155724, 0 3px 6px rgba(0,0,0,0.2)',
        '3d-danger': '0 4px 0 #7a1b22, 0 6px 12px rgba(0,0,0,0.2)',
        '3d-danger-active': '0 1px 0 #7a1b22, 0 3px 6px rgba(0,0,0,0.2)',
        '3d-warning': '0 4px 0 #a07800, 0 6px 12px rgba(0,0,0,0.2)',
        '3d-warning-active': '0 1px 0 #a07800, 0 3px 6px rgba(0,0,0,0.2)',
        '3d-secondary': '0 4px 0 #4a4f52, 0 6px 12px rgba(0,0,0,0.2)',
        '3d-secondary-active': '0 1px 0 #4a4f52, 0 3px 6px rgba(0,0,0,0.2)',
      },
    },
  },
  plugins: [],
};
