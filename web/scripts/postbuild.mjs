// GitHub Pages has no SPA rewrites. For every client-side route we write a copy
// of the app shell at <route>/index.html so deep links and refreshes return
// HTTP 200, and 404.html (also the app shell) handles anything else.
import { copyFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

export const ROUTES = ['overview', 'explorer', 'similar', 'compare', 'model', 'method']

const out = resolve(process.argv[2] ?? 'dist')
const shell = resolve(out, 'index.html')
copyFileSync(shell, resolve(out, '404.html'))
for (const r of ROUTES) {
  mkdirSync(resolve(out, r), { recursive: true })
  copyFileSync(shell, resolve(out, r, 'index.html'))
}
console.log(`postbuild: wrote 404.html and ${ROUTES.map((r) => `${r}/index.html`).join(', ')} in ${out}`)
