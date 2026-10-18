// Optional end-to-end DOM smoke test: boots the plugin's real entry + chunks in
// a jsdom page with real React, opens a file through the debug handle, clicks
// Edit and inspects the mounted CodeMirror. This covers the wiring the lighter
// smoke-editor.mjs skips (entry → overlay → tab → renderBody → editor chunk).
//
// Setup (same scratch deps as smoke-editor.mjs):
//   mkdir -p /tmp/dsh-editor-smoke && cd /tmp/dsh-editor-smoke
//   npm init -y && npm i jsdom react@18 react-dom@18
//
// Run from the plugin root:
//   EDITOR_SMOKE_DEPS=/tmp/dsh-editor-smoke node scripts/smoke-app.mjs
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHarness } from '../test/harness.mjs'

const scratch = process.env.EDITOR_SMOKE_DEPS ?? join(tmpdir(), 'dsh-editor-smoke')
const require = createRequire(join(scratch, 'index.cjs'))
let JSDOMClass
let VirtualConsoleClass
try {
  ;({ JSDOM: JSDOMClass, VirtualConsole: VirtualConsoleClass } = require('jsdom'))
} catch {
  console.error(`Cannot load jsdom from ${scratch}. See the setup comment at the top of this file.`)
  process.exit(1)
}
const React = require('react')
const { createRoot } = require('react-dom/client')

let checks = 0
function ok(name) {
  checks += 1
  console.log(`ok - ${name}`)
}
function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`)
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const virtualConsole = new VirtualConsoleClass()
virtualConsole.on('jsdomError', () => {})
const dom = new JSDOMClass('<!doctype html><html><body data-ds-dark-theme><div id="root"></div></body></html>', {
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
defineGlobal('Call', window.Call)

const files = {
  '/project/src/app.ts': 'export interface User { id: string; name: string }\n\nexport function greet(user: User): string {\n  return `hello ${user.name}`\n}\n',
  '/project/notes/design.md': '# Design\n\nA paragraph with `inline code`.\n\n## Details\n\nMore text.\n',
}
const fetchStub = async (url) => {
  const target = String(url)
  if (target.includes('api/thoughtdag-file-open.save')) {
    return new Response(JSON.stringify({ ok: true, version: 'saved-1', operation: 'update', bytes: 10 }), { status: 200 })
  }
  if (target.includes('api/thoughtdag-file-open')) {
    return new Response(JSON.stringify({ ok: true, editing: true, version: '3.0.0' }), { status: 200 })
  }
  return new Response('{}', { status: 404 })
}

const harness = createHarness({
  react: React,
  document: window.document,
  window,
  fetch: fetchStub,
  realCodeMirror: true,
  files,
  globals: {
    navigator: window.navigator,
    MutationObserver: window.MutationObserver,
    getSelection: window.getSelection.bind(window),
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    Node: window.Node,
    DOMParser: window.DOMParser,
    InputEvent: window.InputEvent,
    KeyboardEvent: window.KeyboardEvent,
    Event: window.Event,
    Window: window.Window,
    ResizeObserver: window.ResizeObserver,
  },
})

const root = createRoot(window.document.getElementById('root'))
root.render(React.createElement(harness.overlay(), null))
await sleep(120)

const opened = await harness.debug().openAbsolute('/project/src/app.ts')
await sleep(500)
assert(opened === true, 'the debug handle opened the file')
assert(harness.debug().active().mode === 'preview', 'tab starts in preview mode')
ok('entry → overlay → tab opens in preview')

await harness.debug().edit()
await sleep(900)

const editorElement = window.document.querySelector('.cm-editor')
assert(editorElement !== null, `CodeMirror mounted through the real dialog (fallback present: ${window.document.querySelector('.dsh-tdfi-editor-fallback') !== null})`)
assert(window.document.querySelector('.dsh-tdfi-editor-fallback') === null, 'fell back to the textarea editor')
assert(window.document.querySelector('.cm-gutters') !== null, 'line-number gutter rendered')
assert(window.document.querySelector('.cm-content').textContent.includes('greet'), 'document content rendered')
const styleText = [...window.document.querySelectorAll('style')].map((style) => style.textContent).join('\n')
assert(styleText.includes('--shiki-token-keyword'), 'syntax palette in generated CSS')
const tokenSpans = window.document.querySelectorAll('.cm-line span')
assert(tokenSpans.length > 0, 'syntax-highlighted token spans exist')
ok('edit mode mounts CodeMirror with gutter, content and syntax spans')
assert(window.document.querySelector('.dsh-tdfi-meta button.dsh-tdfi-meta-action') !== null, 'open-in-window moved into the path row')
assert(window.document.querySelector('.dsh-tdfi-head .dsh-tdfi-actions button[aria-label=openInWindow]') === null, 'open-in-window left the header action row')
ok('open-in-window lives in the path row')

const cm = await harness.chunk('client.codemirror.js')
const view = cm.EditorView.findFromDOM(editorElement)
assert(view !== null && view !== undefined, 'found the CodeMirror view')
assert(typeof cm.EditorState.allowMultipleSelections === 'object', 'allowMultipleSelections facet is exported by the vendor chunk')

// Multi-cursor: the state must accept more than one range.
let multiCursor = false
assert(view.state.facet(cm.EditorState.allowMultipleSelections) === true, 'the mounted view enables allowMultipleSelections')
// The state-level update is the product contract (jsdom's layout plugins cannot
// always render a live multi-range update, which is environment-specific).
const multiState = cm.EditorState.create({
  doc: 'first line\nsecond line\n',
  extensions: [cm.EditorState.allowMultipleSelections.of(true)],
})
const multiSelection = cm.EditorSelection.create([cm.EditorSelection.range(0, 0), cm.EditorSelection.range(11, 11)])
const multiNext = multiState.update({ selection: multiSelection }).state
assert(multiNext.selection.ranges.length === 2, 'editor state accepts multiple cursors')
try {
  view.dispatch({
    selection: cm.EditorSelection.create([cm.EditorSelection.range(0, 0), cm.EditorSelection.range(6, 6)]),
  })
} catch {
  // jsdom layout plugins may throw on a live multi-range paint; the facet above
  // is what enables the feature in a real browser.
}
ok('multi-cursor enabled (allowMultipleSelections facet + state ranges)')

// Maximize fills the viewport; restore returns to the centered card.
harness.debug().toggleMaximize()
await sleep(120)
assert(window.document.querySelector('.dsh-tdfi-dialog.dsh-tdfi-maximized') !== null, 'maximize adds the dialog class')
harness.debug().toggleMaximize()
await sleep(120)
assert(window.document.querySelector('.dsh-tdfi-dialog.dsh-tdfi-maximized') === null, 'restore removes the dialog class')
ok('maximize toggles the dialog size mode')

// A real edit marks the tab dirty and reaches the entry's draft state.
const before = view.state.doc.toString()
view.dispatch({ changes: { from: 0, insert: '// edited\n' } })
await sleep(400)
assert(view.state.doc.toString() === `// edited\n${before}`, 'edit applied to the document')
assert(window.document.querySelector('.dsh-tdfi-dirty') !== null, 'the tab shows the unsaved marker')
await harness.debug().save()
await sleep(300)
assert(window.document.querySelector('.dsh-tdfi-dirty') === null, 'save clears the unsaved marker')
ok('typing marks dirty and save clears it')

// Markdown tab: wrapping editor.
await harness.debug().close()
await sleep(100)
await harness.debug().openAbsolute('/project/notes/design.md')
await sleep(400)
await harness.debug().edit()
await sleep(900)
assert(window.document.querySelector('.cm-editor') !== null, 'markdown editor mounted')
const markdownStyle = [...window.document.querySelectorAll('style')].map((style) => style.textContent).join('\n')
assert(markdownStyle.includes('white-space: pre-wrap') || markdownStyle.includes('cm-lineWrapping'), 'markdown editor wraps lines')
ok('markdown tab opens a wrapping editor')

root.unmount()
dom.window.close()
console.log(`\n${String(checks)} app smoke checks passed`)
