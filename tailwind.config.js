/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./ui/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        cloudflare: {
          orange: '#F6821F',
          blue: '#0051C3',
          dark: '#1F2937',
        },
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
}
