import { existsSync, readFileSync, readdirSync, statSync, createReadStream } from 'node:fs'
import { join, resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const LOCAL_DATA = resolve(import.meta.dirname, 'local-data')

/**
 * Full-data mode (local only). Serves the git-ignored track-level artifacts from
 * web/local-data at <base>data/full/ in dev and preview, and copies them into
 * the separate dist-full/ output for `npm run build:full`. The default
 * aggregate build never touches these files.
 */
function localFullData(base: string): Plugin {
  const prefix = `${base}data/full/`
  const middleware = (req: { url?: string }, res: import('node:http').ServerResponse, next: () => void) => {
    if (!req.url?.startsWith(prefix)) return next()
    const name = decodeURIComponent(req.url.slice(prefix.length).split('?')[0])
    const file = join(LOCAL_DATA, name)
    if (name.includes('..') || !existsSync(file) || !statSync(file).isFile()) {
      res.statusCode = 404
      return res.end('not found')
    }
    res.setHeader('Content-Type', 'application/json')
    createReadStream(file).pipe(res)
  }
  return {
    name: 'tracklens-local-full-data',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
    generateBundle() {
      if (!existsSync(LOCAL_DATA)) {
        this.error('Full mode needs web/local-data. Run `python pipeline/build.py` with the CSV first.')
      }
      for (const name of readdirSync(LOCAL_DATA)) {
        this.emitFile({ type: 'asset', fileName: `data/full/${name}`, source: readFileSync(join(LOCAL_DATA, name)) })
      }
    },
  }
}

export default defineConfig(({ mode }) => {
  const base = process.env.BASE_PATH ?? '/tracklens/'
  const full = mode === 'full'
  return {
    base,
    plugins: [react(), ...(full ? [localFullData(base)] : [])],
    define: { __DATA_MODE__: JSON.stringify(full ? 'full' : 'aggregate') },
    build: {
      outDir: full ? 'dist-full' : 'dist',
      emptyOutDir: true,
      sourcemap: false,
      chunkSizeWarningLimit: 600,
    },
    worker: { format: 'es' as const },
  }
})
