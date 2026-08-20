/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Pretendard Variable", "Pretendard", "-apple-system", "BlinkMacSystemFont", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"]
      },
      colors: {
        navy: {
          950: "#0A0F1E",
          900: "#0D1425",
          800: "#131B2E",
          700: "#1B2540",
          600: "#28345A"
        },
        accent: {
          50: "#EEF1FF",
          100: "#E0E4FF",
          200: "#C6CCFF",
          300: "#A3ACFF",
          400: "#7C87F9",
          500: "#5B62E8",
          600: "#4A4DD6",
          700: "#3D3CB5",
          800: "#312F8F",
          900: "#292A6E"
        }
      },
      boxShadow: {
        card: "0 1px 2px 0 rgba(15, 23, 42, 0.04), 0 1px 3px 0 rgba(15, 23, 42, 0.06)",
        elevated: "0 4px 12px -2px rgba(15, 23, 42, 0.08), 0 2px 4px -2px rgba(15, 23, 42, 0.06)",
        popover: "0 8px 24px -4px rgba(15, 23, 42, 0.16), 0 2px 8px -2px rgba(15, 23, 42, 0.08)"
      },
      borderRadius: {
        xl: "0.75rem",
        "2xl": "1rem"
      },
      keyframes: {
        "fade-in": { from: { opacity: 0 }, to: { opacity: 1 } },
        "slide-up": { from: { opacity: 0, transform: "translateY(6px)" }, to: { opacity: 1, transform: "translateY(0)" } },
        shimmer: { "0%": { backgroundPosition: "-200% 0" }, "100%": { backgroundPosition: "200% 0" } }
      },
      animation: {
        "fade-in": "fade-in 0.2s ease-out",
        "slide-up": "slide-up 0.25s ease-out",
        shimmer: "shimmer 1.8s linear infinite"
      }
    }
  },
  plugins: []
};
