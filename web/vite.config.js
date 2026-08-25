import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    // The Lumnia design system is vendored, not published; see its README.
    // The tokens.css entry must come first — a bare `lumnia-ui` alias would
    // otherwise swallow the subpath and point it inside index.js.
    alias: [
      { find: 'lumnia-ui/tokens.css', replacement: '/src/lib/lumnia-ui/src/tokens.css' },
      { find: 'lumnia-ui', replacement: '/src/lib/lumnia-ui/src/index.js' },
    ],
  },
  server: {
    port: 5173,
    proxy: { '/v1': 'http://localhost:8000' },
  },
})
