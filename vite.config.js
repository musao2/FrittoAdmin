import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Admin sayti — 5173 portda ishlaydi (xodimlar sayti 5174 da)
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
})
