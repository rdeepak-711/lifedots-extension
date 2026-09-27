#!/usr/bin/env node
/**
 * Verify that dist/ is a package the stores will actually accept.
 *
 * This exists because a rejected submission costs days of waiting, and every
 * reason for rejection in the research was mechanical: a missing file, a path
 * that pointed nowhere, a permission with no justification, remote code. All of
 * that is checkable before uploading, so it is checked on every build.
 *
 *     node tools/check-package.mjs
 */

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')

const problems = []
const notes = []
const fail = (m) => problems.push(m)
const note = (m) => notes.push(m)

if (!existsSync(dist)) {
  console.error('✗ dist/ does not exist — run the build first.')
  process.exit(1)
}

// ---------- manifest ----------
const manifestPath = join(dist, 'manifest.json')
if (!existsSync(manifestPath)) {
  console.error('✗ dist/manifest.json is missing.')
  process.exit(1)
}

/** @type {Record<string, any>} */
let manifest
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
} catch (err) {
  console.error('✗ dist/manifest.json is not valid JSON:', err.message)
  process.exit(1)
}

if (manifest.manifest_version !== 3) fail('manifest_version must be 3 — MV2 was removed from the store in Aug 2026.')
if (!manifest.name) fail('manifest is missing a name.')
if (!/^\d+(\.\d+){0,3}$/.test(manifest.version ?? '')) fail(`version "${manifest.version}" is not a valid store version string.`)
if (!manifest.description) fail('manifest is missing a description — the store listing requires one.')
if ((manifest.description ?? '').length > 132) fail('description is over the store limit of 132 characters.')

// ---------- every referenced file must exist ----------
const referenced = new Set()
const requireFile = (relPath, where) => {
  if (!relPath) return
  referenced.add(relPath)
  if (!existsSync(join(dist, relPath))) fail(`${where} points at "${relPath}", which is not in dist/.`)
}

requireFile(manifest.action?.default_popup, 'action.default_popup')
requireFile(manifest.background?.service_worker, 'background.service_worker')
for (const [size, path] of Object.entries(manifest.icons ?? {})) requireFile(path, `icons[${size}]`)
for (const [size, path] of Object.entries(manifest.action?.default_icon ?? {})) {
  requireFile(path, `action.default_icon[${size}]`)
}
for (const entry of manifest.content_scripts ?? []) {
  for (const js of entry.js ?? []) requireFile(js, 'content_scripts.js')
  for (const css of entry.css ?? []) requireFile(css, 'content_scripts.css')
}

// ---------- store icon rules ----------
for (const size of ['16', '48', '128']) {
  if (!manifest.icons?.[size]) fail(`icons.${size} is required by the Chrome Web Store.`)
}

// ---------- permissions ----------
const perms = manifest.permissions ?? []
const hosts = manifest.host_permissions ?? []
if (hosts.includes('<all_urls>') || hosts.some((h) => h === '*://*/*' || h === 'https://*/*')) {
  fail('host_permissions requests every site. LifeDots decided against this in step 05 — it is the scariest line in the install dialog and slows review.')
}
const scary = perms.filter((p) => ['tabs', 'history', 'bookmarks', 'cookies', 'webRequest', 'debugger'].includes(p))
if (scary.length) note(`permissions needing a written justification at submission: ${scary.join(', ')}`)

// ---------- no remote code (MV3 hard rule) ----------
const walk = (dir) => {
  /** @type {string[]} */
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

const files = walk(dist)
const remotePattern = /(?:src|href)\s*=\s*["']https?:\/\//i
const importPattern = /\bimport\s*\(\s*["']https?:\/\//i

for (const file of files) {
  if (!/\.(js|html|css)$/.test(file) || file.endsWith('.map')) continue
  const body = readFileSync(file, 'utf8')
  const rel = file.slice(dist.length + 1)
  if (remotePattern.test(body)) fail(`${rel} loads something over the network — MV3 forbids remotely hosted code, and it breaks "nothing leaves your computer".`)
  if (importPattern.test(body)) fail(`${rel} dynamically imports a remote URL — MV3 forbids this.`)
}

// ---------- size ----------
const totalBytes = files.reduce((sum, f) => sum + statSync(f).size, 0)
const mapBytes = files.filter((f) => f.endsWith('.map')).reduce((s, f) => s + statSync(f).size, 0)
note(`package is ${(totalBytes / 1024).toFixed(1)} KB (${(mapBytes / 1024).toFixed(1)} KB of that is source maps)`)
if (totalBytes > 2 * 1024 * 1024 * 1024) fail('package is over the 2 GB store limit.')

// ---------- report ----------
console.log(`\nLifeDots package check — ${manifest.name} v${manifest.version}`)
console.log(`  ${files.length} files, ${referenced.size} referenced by the manifest`)
for (const n of notes) console.log(`  · ${n}`)

if (problems.length) {
  console.error(`\n✗ ${problems.length} problem${problems.length === 1 ? '' : 's'}:`)
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}

console.log('\n✓ package looks loadable and submittable.\n')
