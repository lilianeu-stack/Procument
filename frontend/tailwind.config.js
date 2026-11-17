/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#172638',
        muted: '#718096',
        canvas: '#f5f7fb',
        brand: { DEFAULT: '#356c63', dark: '#28574f', light: '#e5f1ed' }
      },
      boxShadow: { card: '0 4px 18px rgba(27, 46, 67, 0.045)' }
    }
  },
  plugins: []
};
