module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: '#2c3e50',
        coral: '#FF7E5D',
        warmbg: '#f8f9fa',
      },
      fontFamily: {
        display: ['Nunito', 'ui-sans-serif', 'system-ui'],
        body: ['Inter', 'ui-sans-serif', 'system-ui'],
      },
      boxShadow: {
        soft: '0 4px 6px -1px rgba(0,0,0,0.1)'
      }
    },
  },
  plugins: [],
}
