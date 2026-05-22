/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#0d1117',
        surface: '#161b22',
        border: '#30363d',
        primary: '#58a6ff',
        textMain: '#c9d1d9',
        textMuted: '#8b949e',
      }
    },
  },
  plugins: [],
}
