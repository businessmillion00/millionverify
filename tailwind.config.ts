import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class'],
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        dark: {
          50: '#f6f6f6',
          100: '#e7e7e7',
          200: '#d1d1d1',
          300: '#b0b0b0',
          400: '#888888',
          500: '#6d6d6d',
          600: '#5d5d5d',
          700: '#4f4f4f',
          800: '#454545',
          900: '#1a1a1a',
          950: '#121212',
        },
        amber: {
          50: '#fffbeb',
          100: '#fef3c7',
          200: '#fde68a',
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
          800: '#92400e',
          900: '#78350f',
          950: '#5a2e0f',
        },
        gold: {
          50: '#fefdf4',
          100: '#fffae6',
          200: '#fff5cc',
          300: '#ffeaa7',
          400: '#ffda79',
          500: '#ffc947',
          600: '#d4af37',
          700: '#b8860b',
          800: '#8b6914',
          900: '#6b5410',
          950: '#504209',
        },
      },
      backgroundImage: {
        'gradient-luxury': 'linear-gradient(135deg, #121212 0%, #1a1a1a 100%)',
        'gradient-amber': 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)',
        'gradient-amber-subtle': 'linear-gradient(135deg, rgba(245,158,11,0.1) 0%, rgba(217,119,6,0.05) 100%)',
      },
      backdropBlur: {
        xs: '2px',
      },
      boxShadow: {
        'luxury': '0 20px 60px rgba(0, 0, 0, 0.3), 0 0 1px rgba(245, 158, 11, 0.2)',
        'luxury-sm': '0 4px 12px rgba(0, 0, 0, 0.2)',
        'amber-glow': '0 0 30px rgba(245, 158, 11, 0.2), 0 0 60px rgba(217, 119, 6, 0.1)',
      },
      animation: {
        'float': 'float 3s ease-in-out infinite',
        'glow': 'glow 2s ease-in-out infinite',
        'pulse-amber': 'pulse-amber 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        glow: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
        'pulse-amber': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(245, 158, 11, 0.7)' },
          '50%': { boxShadow: '0 0 0 10px rgba(245, 158, 11, 0)' },
        },
      },
    },
  },
  plugins: [],
}

export default config
