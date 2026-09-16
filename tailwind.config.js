/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontSize: {
        // Base scale bumped ~12% (18px root instead of 16px)
        base: ['1.125rem', { lineHeight: '1.75' }],
        lg:   ['1.25rem',  { lineHeight: '1.75' }],
        xl:   ['1.375rem', { lineHeight: '1.75' }],
        '2xl':['1.625rem', { lineHeight: '1.3'  }],
        '3xl':['2rem',     { lineHeight: '1.25' }],
        '4xl':['2.5rem',   { lineHeight: '1.15' }],
        '5xl':['3.25rem',  { lineHeight: '1.1'  }],
        '6xl':['4rem',     { lineHeight: '1.05' }],
        '7xl':['5rem',     { lineHeight: '1'    }],
        '8xl':['6.5rem',   { lineHeight: '0.95', letterSpacing: '-0.03em' }],
        // Swiss-school display classes for Hero
        'display-sm': ['5rem',   { lineHeight: '1',    letterSpacing: '-0.025em', fontWeight: '700' }],
        'display':    ['6.5rem', { lineHeight: '0.96', letterSpacing: '-0.03em',  fontWeight: '700' }],
        'display-lg': ['8rem',   { lineHeight: '0.92', letterSpacing: '-0.04em',  fontWeight: '700' }],
      },
    },
  },
  plugins: [],
};
