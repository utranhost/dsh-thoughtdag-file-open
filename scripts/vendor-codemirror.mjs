// Rebuild the vendored CodeMirror 6 bundle that powers the in-page editor.
//
// The plugin ships no runtime dependencies: `client.codemirror.js` at the
// package root is a committed, self-contained IIFE produced by this script
// from the exact package versions pinned in `vendor/codemirror/package.json`.
// Run it only when bumping CodeMirror:
//
//   node scripts/vendor-codemirror.mjs          # install (if needed) + bundle
//   node scripts/vendor-codemirror.mjs --refresh # force `npm ci` first
//
// It writes:
//   client.codemirror.js          the bundle wrapped for DSH's ModuleLoader
//   vendor/codemirror/LICENSES.md third-party license notices
//
// Requires network access to the npm registry the first time (or after
// --refresh). The working directory `vendor/codemirror/node_modules` is
// git-ignored; the produced artifacts are committed.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const VENDOR = join(ROOT, 'vendor', 'codemirror')
const OUTPUT = join(ROOT, 'client.codemirror.js')
const LICENSES = join(VENDOR, 'LICENSES.md')
const PLUGIN_ID = 'dsh-thoughtdag-file-open'
const CHUNK_NAME = 'client.codemirror.js'
const GLOBAL_NAME = '__VENDORED_CODEMIRROR'

const refresh = process.argv.includes('--refresh')
const vendorPkg = JSON.parse(readFileSync(join(VENDOR, 'package.json'), 'utf8'))
const versions = Object.entries(vendorPkg.dependencies)
  .map(([name, version]) => [name, version.replace(/^[\^~]/, '')])
  .sort(([a], [b]) => a.localeCompare(b))

function run(command, args, options) {
  execFileSync(command, args, { cwd: VENDOR, stdio: 'inherit', ...options })
}

// ── 1. dependencies ────────────────────────────────────────────────────────
if (refresh || !existsSync(join(VENDOR, 'node_modules'))) {
  const lock = join(VENDOR, 'package-lock.json')
  if (existsSync(lock)) {
    console.log('[vendor-codemirror] npm ci')
    run('npm', ['ci', '--no-audit', '--no-fund', '--ignore-scripts'])
  } else {
    console.log('[vendor-codemirror] npm install --package-lock-only then ci')
    run('npm', ['install', '--package-lock-only', '--no-audit', '--no-fund', '--ignore-scripts'])
    run('npm', ['ci', '--no-audit', '--no-fund', '--ignore-scripts'])
  }
}

// ── 2. bundle ──────────────────────────────────────────────────────────────
const work = mkdtempSync(join(tmpdir(), 'codemirror-vendor-'))
const bundlePath = join(work, 'bundle.js')
try {
  console.log('[vendor-codemirror] esbuild bundle')
  run(join(VENDOR, 'node_modules', '.bin', 'esbuild'), [
    'entry.js',
    '--bundle',
    '--minify',
    '--format=iife',
    `--global-name=${GLOBAL_NAME}`,
    '--platform=browser',
    '--target=es2020',
    '--charset=utf8',
    '--legal-comments=none',
    `--outfile=${bundlePath}`,
  ])
  const bundle = readFileSync(bundlePath, 'utf8')
  if (!bundle.includes(`var ${GLOBAL_NAME}`)) {
    throw new Error(`esbuild output does not define ${GLOBAL_NAME}`)
  }
  const packageList = versions.map(([name, version]) => `${name}@${version}`).join(', ')
  const header = `// ${PLUGIN_ID} — chunk: vendored CodeMirror 6 editor core.
//
// GENERATED FILE — do not edit. Rebuild with:
//   node ${join('scripts', 'vendor-codemirror.mjs')}
// from vendor/codemirror (pinned versions live in vendor/codemirror/package.json).
//
// Bundles ${versions.length} packages: ${packageList}.
// All bundled code is MIT licensed; see vendor/codemirror/LICENSES.md.
`
  const wrapped = `${header}window.__ModuleLoader__.load({
  id: '${PLUGIN_ID}',
  chunk: '${CHUNK_NAME}',
  factory: () => {
${bundle}
    return ${GLOBAL_NAME}
  },
})
`
  writeFileSync(OUTPUT, wrapped)
  const bytes = Buffer.byteLength(wrapped)
  console.log(`[vendor-codemirror] wrote ${OUTPUT} (${(bytes / 1024).toFixed(1)} KiB)`)

  // ── 3. third-party license notices ──────────────────────────────────────
  // Concatenate the LICENSE/COPYING files of every installed package the
  // bundle was built from, so the committed artifact carries its notices.
  const sections = [
    `# Third-party notices for \`${CHUNK_NAME}\``,
    '',
    `This bundle is built from the following pinned packages:`,
    '',
    ...versions.map(([name, version]) => `- \`${name}@${version}\``),
    '',
    'The bundle also includes their transitive dependencies. License texts are',
    'reproduced below, one section per installed package that ships one.',
    '',
  ]
  const seen = new Set()
  // npm hoists the closure flat: plain directories plus one level of scopes.
  const moduleRoot = join(VENDOR, 'node_modules')
  const packageDirs = []
  for (const entry of readdirSync(moduleRoot, { withFileTypes: true })) {
    if (entry.name === '.bin' || entry.name.startsWith('.')) continue
    if (entry.name.startsWith('@')) {
      for (const scoped of readdirSync(join(moduleRoot, entry.name), { withFileTypes: true })) {
        if (scoped.isDirectory()) packageDirs.push(join(moduleRoot, entry.name, scoped.name))
      }
      continue
    }
    if (entry.isDirectory()) packageDirs.push(join(moduleRoot, entry.name))
  }
  packageDirs.sort()
  for (const pkgDir of packageDirs) {
    const manifest = join(pkgDir, 'package.json')
    if (!existsSync(manifest)) continue
    const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
    if (typeof pkg.name !== 'string' || typeof pkg.version !== 'string') continue
    if (seen.has(pkg.name)) continue
    seen.add(pkg.name)
    const licenseFile = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING', 'COPYING.md'].find((file) =>
      existsSync(join(pkgDir, file)),
    )
    sections.push(`## ${pkg.name}@${pkg.version}`, '', `License: ${pkg.license ?? 'see below'}`, '')
    if (licenseFile !== undefined) {
      sections.push('```', readFileSync(join(pkgDir, licenseFile), 'utf8').trim(), '```', '')
    }
  }
  writeFileSync(LICENSES, `${sections.join('\n')}\n`)
  console.log(`[vendor-codemirror] wrote ${LICENSES} (${seen.size} packages)`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
