import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        mpr: resolve(__dirname, 'mpr.html'),
      },
    },
  },
})
