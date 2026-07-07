import { resolve } from 'node:path'
import { defineConfig } from 'vite'

const nnInteractiveProxyTarget = process.env.VITE_NNINTERACTIVE_PROXY_TARGET ?? 'http://127.0.0.1:1528'

export default defineConfig({
  server: {
    proxy: {
      '/nninteractive': {
        target: nnInteractiveProxyTarget,
        changeOrigin: true,
        rewrite: path => path.replace(/^\/nninteractive/, ''),
      }
    },
  },
  build: {
    rollupOptions: {
      input: {
        mpr: resolve(__dirname, 'mpr.html'),
      },
    },
  },
})
