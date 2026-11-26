// Guards the public build: no restricted files, correct subpath, and a size report.
//   node scripts/check-dist.mjs [dist] [--base /tracklens/]
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

const args = process.argv.slice(2)
const dist = resolve(args.find((a) => !a.startsWith('--')) ?? 'dist')
const base = args.includes('--base') ? args[args.indexOf('--base') + 1] : process.env.BASE_PATH ?? '/tracklens/'
const ALLOWED_DATA = new Set(['genres.json', 'meta.json', 'model-eval.json', 'model.json', 'overview.json', 'similarity.json'])
const failures = []

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

if (!existsSync(dist)) {
  console.error(`check-dist: ${dist} does not exist; run the build first`)
  process.exit(1)
}
const files = walk(dist)
const rel = (p) => relative(dist, p).split('\\').join('/')

for (const f of files) {
  const r = rel(f)
  if (r.startsWith('data/full/') || r.includes('tracks.json')) failures.push(`restricted track-level file in build: ${r}`)
  if (r.endsWith('.csv')) failures.push(`CSV in build: ${r}`)
  if (r.startsWith('data/') && !ALLOWED_DATA.has(r.slice(5))) failures.push(`unexpected data file: ${r}`)
}
for (const name of ALLOWED_DATA) if (!existsSync(join(dist, 'data', name))) failures.push(`missing data/${name}`)
for (const page of ['index.html', '404.html', 'overview/index.html', 'explorer/index.html', 'similar/index.html', 'compare/index.html', 'model/index.html', 'method/index.html']) {
  const p = join(dist, page)
  if (!existsSync(p)) {
    failures.push(`missing ${page}`)
    continue
  }
  const html = readFileSync(p, 'utf8')
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((u) => !u.startsWith('http') && !u.startsWith('#'))
  for (const u of refs) if (!u.startsWith(base)) failures.push(`${page} references ${u} outside base ${base}`)
}

// If local full data exists, make sure none of its track IDs leaked into any file.
const local = resolve(dist, '..', 'local-data', 'tracks.json')
if (existsSync(local)) {
  const ids = new Set(JSON.parse(readFileSync(local, 'utf8')).id)
  const idRe = /\b[0-9A-Za-z]{22}\b/g
  for (const f of files) {
    const text = readFileSync(f).toString('latin1')
    for (const m of text.matchAll(idRe)) if (ids.has(m[0])) failures.push(`track ID ${m[0]} found in ${rel(f)}`)
  }
}

const rows = files
  .map((f) => {
    const buf = readFileSync(f)
    return { file: rel(f), bytes: buf.length, gzip: gzipSync(buf, { level: 9 }).length }
  })
  .sort((a, b) => b.bytes - a.bytes)
const kb = (n) => `${(n / 1024).toFixed(1)} kB`
console.log('Build size (raw / gzip):')
for (const r of rows) console.log(`  ${r.file.padEnd(44)} ${kb(r.bytes).padStart(10)} ${kb(r.gzip).padStart(10)}`)
const sum = (k, pred = () => true) => rows.filter(pred).reduce((a, r) => a + r[k], 0)
const js = (r) => r.file.endsWith('.js')
console.log(`  ${'TOTAL'.padEnd(44)} ${kb(sum('bytes')).padStart(10)} ${kb(sum('gzip')).padStart(10)}`)
console.log(`  ${'JavaScript'.padEnd(44)} ${kb(sum('bytes', js)).padStart(10)} ${kb(sum('gzip', js)).padStart(10)}`)

if (failures.length) {
  console.error('\ncheck-dist FAILED:\n  ' + failures.join('\n  '))
  process.exit(1)
}
console.log('\ncheck-dist passed: aggregate-only data, assets under ' + base)
