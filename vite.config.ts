import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  test: {
    // Domain logic is DOM-free; node is enough and fast.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
