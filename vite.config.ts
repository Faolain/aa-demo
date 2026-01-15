import path from 'path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Add COOP/COEP headers for passkey + injected wallet demos that rely on crossOriginIsolated APIs.
function crossOriginIsolationPlugin(): Plugin {
  const coepMode = process.env.VITE_COEP_MODE ?? 'credentialless'
  return {
    name: 'cross-origin-isolation',
    configureServer(server) {
      server.middlewares.use((_, res, next) => {
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
        res.setHeader('Cross-Origin-Embedder-Policy', coepMode)
        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [
    crossOriginIsolationPlugin(),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: [{ find: '@', replacement: path.resolve(__dirname, 'src') }],
  },
  server: {
    host: '0.0.0.0',
    allowedHosts: ['localhost', '127.0.0.1', 'wallet.local', 'app.localhost'],
  },
})
