/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#09090f",
        surface: "#111118",
        border: "#1e1e2e",
        accent: "#7c3aed",
        "accent-light": "#a855f7",
      },
    },
  },
  plugins: [],
};
