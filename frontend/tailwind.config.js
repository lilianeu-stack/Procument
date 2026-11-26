/** @type {import('tailwindcss').Config} */
const blackText = 'var(--text-primary)';
const paletteShades = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'];
const paletteFamilies = [
  'slate', 'gray', 'zinc', 'neutral', 'stone',
  'red', 'orange', 'amber', 'yellow', 'lime',
  'green', 'emerald', 'teal', 'cyan', 'sky',
  'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose'
];

// Every text utility resolves through one canonical token. Backgrounds,
// borders, hover surfaces and focus rings keep their authored colors.
const blackTextPalette = {
  inherit: blackText,
  current: blackText,
  transparent: blackText,
  black: blackText,
  white: blackText,
  ...Object.fromEntries(paletteFamilies.map((family) => [
    family,
    Object.fromEntries(paletteShades.map((shade) => [shade, blackText]))
  ]))
};

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
      // Color-only remap: no text utility can introduce blue, green, grey, red
      // or white text, while bg-*/border-* utilities remain unchanged.
      textColor: {
        ...blackTextPalette,
        ink: blackText,
        muted: blackText,
        canvas: blackText,
        reference: blackText,
        success: blackText,
        hover: blackText,
        brand: { DEFAULT: blackText, dark: blackText, light: blackText },
        accent: {
          DEFAULT: blackText,
          text: blackText,
          tint: blackText,
          strong: blackText,
          row: blackText,
          field: blackText,
          border: blackText,
          focus: blackText,
          ring: blackText
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
