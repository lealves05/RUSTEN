/** Paleta RUSTEN: grafite, preto, creme, cobre e vermelho queimado — via variáveis (tema claro/escuro). */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: ['class'],
  theme: {
    extend: {
      colors: {
        bg: 'rgb(var(--bg) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        raised: 'rgb(var(--raised) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        copper: 'rgb(var(--copper) / <alpha-value>)',
        rust: 'rgb(var(--rust) / <alpha-value>)',
        ok: 'rgb(var(--ok) / <alpha-value>)',
        warn: 'rgb(var(--warn) / <alpha-value>)',
      },
      fontFamily: {
        display: ['var(--font-display)'],
        sans: ['var(--font-body)'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};
