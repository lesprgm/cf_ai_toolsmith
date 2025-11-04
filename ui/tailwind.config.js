/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./pages/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'cloudflare-orange': '#F6821F',
        'cloudflare-blue': '#0051C3',
      },
    },
  },
  plugins: [],
}
