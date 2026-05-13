/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Syne', 'sans-serif'],
        body: ['DM Sans', 'sans-serif'],
        mono: ['DM Mono', 'monospace'],
      },
      colors: {
        void: '#08080a',
        surface: '#0e0e12',
        glass: '#14141a',
        border: '#1e1e28',
        cyan: {
          DEFAULT: '#00d4ff',
          dim: '#00a8cc',
          muted: 'rgba(0,212,255,0.08)',
        },
        rose: {
          DEFAULT: '#ff6b8a',
          dim: '#cc4f6b',
          muted: 'rgba(255,107,138,0.08)',
        },
        text: {
          primary: '#f0f0f5',
          secondary: '#8888a0',
          muted: '#44445a',
        },
      },
      backgroundImage: {
        'mesh-cyan': 'radial-gradient(ellipse 60% 50% at 20% 40%, rgba(0,212,255,0.07) 0%, transparent 60%)',
        'mesh-rose': 'radial-gradient(ellipse 60% 50% at 80% 70%, rgba(255,107,138,0.05) 0%, transparent 60%)',
      },
      boxShadow: {
        glass: '0 0 0 1px rgba(255,255,255,0.04), 0 4px 32px rgba(0,0,0,0.5)',
        glow: '0 0 20px rgba(0,212,255,0.15)',
        'glow-rose': '0 0 20px rgba(255,107,138,0.15)',
      },
      animation: {
        'pulse-slow': 'pulse 3s ease-in-out infinite',
        shimmer: 'shimmer 1.8s ease-in-out infinite',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
    },
  },
  plugins: [],
};
