/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: 'var(--pims-ink)',
        muted: 'var(--pims-ink)',
        canvas: 'var(--pims-surface)',
        reference: 'var(--pims-reference)',
        success: 'var(--pims-success)',
        hover: 'var(--pims-hover)',
        brand: { DEFAULT: 'var(--pims-surface)', dark: 'var(--pims-hover)', light: 'var(--pims-surface)' },
        accent: {
          DEFAULT: 'var(--pims-interaction-green)',
          text: 'var(--pims-interaction-green-text)',
          tint: 'var(--pims-interaction-tint)',
          strong: 'var(--pims-interaction-tint-strong)',
          row: 'var(--pims-interaction-row-tint)',
          field: 'var(--pims-interaction-field-tint)',
          border: 'var(--pims-interaction-border)',
          focus: 'var(--pims-interaction-focus)',
          ring: 'var(--pims-interaction-ring)'
        }
      },
      borderColor: {
        subtle: 'var(--pims-border-subtle)',
        brand: 'var(--pims-border)',
        strong: 'var(--pims-border-strong)'
      },
      ringColor: {
        brand: 'var(--pims-border)'
      },
      boxShadow: {
        card: 'none',
        dashboard: '0 1px 2px rgba(0, 0, 0, 0.05), 0 10px 24px rgba(0, 0, 0, 0.04)'
      }
    }
  },
  plugins: []
};
