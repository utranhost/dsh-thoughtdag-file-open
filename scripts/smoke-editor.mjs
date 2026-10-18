// Optional DOM smoke test for the vendored CodeMirror editor.
//
// The plugin's own test suite is browser-free (test/logic.mjs, test/route.mjs).
// This script adds a heavier integration check: it boots a jsdom document,
// executes the real vendored chunk, mounts the real editor chunk with real
// React, and verifies mount, theming, language support, wrapping and the
// dirty/draft/flush/baseline wiring.
//
// It needs jsdom and React 18 outside the plugin (the plugin ships no
// dependencies). Set up a scratch directory once:
//
//   mkdir -p /tmp/dsh-editor-smoke && cd /tmp/dsh-editor-smoke
//   npm init -y && npm i jsdom react@18 react-dom@18
//
// Then run from the plugin root:
//
//   EDITOR_SMOKE_DEPS=/tmp/dsh-editor-smoke node scripts/smoke-editor.mjs
//
// jsdom has no layout engine, so CodeMirror's measuring code logs soft
// `getClientRects` errors; they do not affect the assertions.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const scratch = process.env.EDITOR_SMOKE_DEPS ?? join(tmpdir(), 'dsh-editor-smoke')
const require = createRequire(join(scratch, 'index.cjs'))

let JSDOM
let VirtualConsole
try {
  ;({ JSDOM, VirtualConsole } = require('jsdom'))
} catch {
  console.error(`Cannot load jsdom from ${scratch}. See the setup comment at the top of this file.`)
  process.exit(1)
}
const React = require('react')

let checks = 0
function ok(name) {
  checks += 1
  console.log(`ok - ${name}`)
}
function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`)
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ── a DOM to mount into ────────────────────────────────────────────────────
const virtualConsole = new VirtualConsole()
virtualConsole.on('jsdomError', () => {})
const dom = new JSDOM('<!doctype html><html><body data-ds-dark-theme><div id="root"></div></body></html>', {
  pretendToBeVisual: true,
  url: 'https://dsh.test/',
  virtualConsole,
})
const { window } = dom
function defineGlobal(name, value) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
}
defineGlobal('window', window)
defineGlobal('document', window.document)
defineGlobal('navigator', window.navigator)
defineGlobal('MutationObserver', window.MutationObserver)
defineGlobal('getSelection', window.getSelection.bind(window))
defineGlobal('requestAnimationFrame', window.requestAnimationFrame.bind(window))
defineGlobal('cancelAnimationFrame', window.cancelAnimationFrame.bind(window))
defineGlobal('HTMLElement', window.HTMLElement)
defineGlobal('Element', window.Element)
defineGlobal('Node', window.Node)
defineGlobal('DOMParser', window.DOMParser)
defineGlobal('InputEvent', window.InputEvent)
defineGlobal('KeyboardEvent', window.KeyboardEvent)
defineGlobal('Event', window.Event)
defineGlobal('Window', window.Window)
defineGlobal('ResizeObserver', window.ResizeObserver)

// ── the real vendored chunk ───────────────────────────────────────────────
const registrations = new Map()
window.__ModuleLoader__ = {
  load(registration) {
    registrations.set(registration.chunk ?? 'entry', registration)
  },
}
vm.runInThisContext(readFileSync(join(ROOT, 'client.codemirror.js'), 'utf8'), { filename: 'client.codemirror.js' })
const cmRegistration = registrations.get('client.codemirror.js')
if (cmRegistration === undefined) throw new Error('vendor chunk did not register')
const CM = cmRegistration.factory(() => {
  throw new Error('vendored bundle must be self-contained')
})
assert(typeof CM.EditorView === 'function', 'vendor exports EditorView')
assert(typeof CM.HighlightStyle === 'function', 'vendor exports HighlightStyle')
assert(typeof CM.markdown === 'function', 'vendor exports markdown language')
assert(typeof CM.closeSearchPanel === 'function', 'vendor exports closeSearchPanel')
ok('vendored CodeMirror bundle executes and exports the editor API')

// ── the real editor chunk, real React ────────────────────────────────────
vm.runInThisContext(readFileSync(join(ROOT, 'client.editor.js'), 'utf8'), { filename: 'client.editor.js' })
const editorRegistration = registrations.get('client.editor.js')
if (editorRegistration === undefined) throw new Error('editor chunk did not register')
const editorRequire = (specifier) => {
  if (specifier === 'react') return React
  throw new Error(`unexpected require(${specifier})`)
}
editorRequire.async = async (specifier) => {
  if (specifier === './client.codemirror.js') return CM
  throw new Error(`unexpected async require(${specifier})`)
}
const editorChunk = editorRegistration.factory(editorRequire)
const { createEditor, isDarkTheme } = editorChunk
assert(isDarkTheme() === true, 'dark theme detected from body attribute')
const { Editor } = createEditor({ t: (key) => key })

// ── mount, inspect, edit ─────────────────────────────────────────────────
const { createRoot } = require('react-dom/client')
const rootElement = window.document.getElementById('root')
const root = createRoot(rootElement)
const events = { drafts: [], dirty: [], api: null, readyCalls: 0 }
const editorProps = {
  initialText: 'const answer = 42\nconsole.log(answer)\n',
  text: 'const answer = 42\nconsole.log(answer)\n',
  savedText: 'const answer = 42\nconsole.log(answer)\n',
  path: '/project/src/answer.ts',
  initialLine: 2,
  onDraft: (value) => events.drafts.push(value),
  onDirtyChange: (value) => events.dirty.push(value),
  onReady: (api) => {
    events.api = api
    events.readyCalls += 1
  },
}
root.render(React.createElement(Editor, editorProps))
await sleep(600)

assert(rootElement.querySelector('.cm-editor') !== null, 'CodeMirror editor mounted into the dialog body')
assert(rootElement.querySelector('.cm-content') !== null, 'editor has a content element')
assert(rootElement.querySelector('.cm-gutters') !== null, 'editor has the line-number gutter')
assert(rootElement.querySelector('.cm-content').textContent.includes('const answer'), 'document text rendered')
assert(rootElement.querySelector('.dsh-tdfi-cm-loading') === null, 'loading placeholder removed after mount')
assert(events.api !== null, 'editor published its imperative API')
assert(events.api.getText() === editorProps.text, 'api.getText returns the document')
ok('editor mounts in a DOM with gutter and document content')

const styleText = [...window.document.querySelectorAll('style')].map((style) => style.textContent).join('\n')
assert(styleText.includes('--shiki-token-keyword'), 'syntax highlight style uses the Harness Shiki palette')
assert(styleText.includes('--dsw-alias-bg-document-selection'), 'selection uses the DSH document-selection token')
assert(styleText.includes('--dsw-alias-bg-layer-1'), 'editor chrome uses DSH surface tokens')
ok('theme and syntax rules are generated from DSH tokens')

assert(rootElement.querySelectorAll('.cm-line span').length > 0, 'language support produced highlighted tokens')
ok('TypeScript language support highlights the buffer')

// ── real edits through CodeMirror's update listener ──────────────────────
const view = CM.EditorView.findFromDOM(rootElement.querySelector('.cm-editor'))
assert(view !== null && view !== undefined, 'found the mounted CodeMirror view')
events.dirty.length = 0
events.drafts.length = 0
view.dispatch({ changes: { from: 0, insert: 'X' } })
assert(events.dirty.includes(true), 'a document change reports dirty immediately')
await sleep(320)
assert(events.drafts[events.drafts.length - 1] === `X${editorProps.text}`, 'debounced draft carries the edited text')
assert(events.api.flush() === `X${editorProps.text}`, 'flush returns the live document synchronously')
events.api.setBaseline(`X${editorProps.text}`)
assert(events.dirty[events.dirty.length - 1] === false, 'moving the baseline clears dirty')
ok('dirty, debounced draft, flush and baseline track real CodeMirror edits')

// ── conflict reload path and markdown wrapping ──────────────────────────
events.api.setText('reloaded from disk\n')
assert(events.api.getText() === 'reloaded from disk\n', 'setText replaces the document (conflict reload)')
ok('conflict reload replaces the document')

root.render(
  React.createElement(Editor, {
    ...editorProps,
    key: 'markdown',
    initialText: 'hello\n',
    text: 'hello\n',
    savedText: 'hello\n',
    path: '/project/notes.md',
  }),
)
await sleep(600)
assert(rootElement.querySelector('.cm-editor') !== null, 'markdown editor remounted')
const markdownStyle = [...window.document.querySelectorAll('style')].map((style) => style.textContent).join('\n')
assert(
  markdownStyle.includes('white-space: pre-wrap') || markdownStyle.includes('cm-lineWrapping'),
  'markdown enables line wrapping',
)
ok('markdown files open in a wrapping editor')

root.unmount()
dom.window.close()
console.log(`\n${String(checks)} smoke checks passed`)
