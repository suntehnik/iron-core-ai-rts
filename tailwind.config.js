/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        rts: {
          dark: '#0e1117',
          panel: '#161b22',
          border: '#30363d',
          accent: '#238636',
          metal: '#8b949e',
          energy: '#e3b341',
          scrap: '#d29922',
          red: '#f85149',
          blue: '#58a6ff',
        }
      },
      fontFamily: {
        game: ['"Chakra Petch"', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
