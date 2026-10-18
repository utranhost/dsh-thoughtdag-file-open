// Browser-free test harness for dsh-thoughtdag-file-open.
//
// The plugin is a client bundle: `client.js` registers a lazy factory and
// loads package-local chunks with `require.async("./client.<name>.js")`. This
// harness reproduces exactly that contract in a vm context — a fake
// `window.__ModuleLoader__`, a seed table for `react` and the DSH primitives,
// and a virtual filesystem behind the injected Remote faces — so the tab
// state, the open/resolve path and the edit/save flow can be exercised in Node
// without a browser.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
export const NS = 'dsh-thoughtdag-file-open'

/** Locale translator stub: the tests assert behaviour, not copy. */
function translate(key, params) {
  return params === undefined ? key : `${key}:${JSON.stringify(params)}`
}

/**
 * A stub for the vendored CodeMirror chunk.
 *
 * Shallow rendering never attaches a DOM ref, so the editor's mount effect
 * aborts before touching CodeMirror; this stub exists so requiring the vendor
 * chunk (695 KiB of browser code) never happens in Node. It mirrors just the
 * API surface the editor chunk touches at import time.
 */
export function createFakeCodeMirror() {
  const tag = function tag() {}
  const tags = new Proxy(
    {},
    {
      get: () => tag,
    },
  )
  function makeDoc(text) {
    const value = typeof text === 'string' ? text : ''
    const parts = value.split('\n')
    return {
      toString: () => value,
      length: value.length,
      lines: parts.length,
      line(number) {
        const clamped = Math.max(1, Math.min(parts.length, number))
        let from = 0
        for (let index = 0; index < clamped - 1; index += 1) from += parts[index].length + 1
        return { from, text: parts[clamped - 1] }
      },
    }
  }
  class Compartment {
    of(extension) {
      return extension
    }
    reconfigure(extension) {
      return extension
    }
  }
  class EditorView {
    static theme() {
      return {}
    }
    static lineWrapping = {}
    static contentAttributes = { of: () => ({}) }
    static clickAddsSelectionRange = { of: () => ({}) }
    static domEventHandlers = (handlers) => ({ handlers })
    static updateListener = { of: (listener) => ({ listener }) }
    static scrollIntoView() {
      return {}
    }
    constructor({ doc, parent }) {
      this.docText = typeof doc === 'string' ? doc : ''
      this.parent = parent
      this.dom = { querySelector: () => null }
      this.state = { doc: makeDoc(this.docText), lines: 1 }
    }
    dispatch(transaction) {
      const changes = transaction?.changes
      if (changes !== null && changes !== undefined && typeof changes.insert === 'string') {
        this.docText = changes.insert
        this.state = { doc: makeDoc(this.docText), lines: 1 }
      }
    }
    focus() {}
    destroy() {}
  }
  const extension = () => ({})
  const language = () => ({})
  return {
    Compartment,
    EditorState: { tabSize: { of: () => ({}) }, allowMultipleSelections: { of: () => ({}) } },
    EditorView,
    tags,
    HighlightStyle: { define: () => ({}) },
    StreamLanguage: { define: () => ({}) },
    lineNumbers: extension,
    highlightActiveLineGutter: extension,
    highlightSpecialChars: extension,
    history: extension,
    foldGutter: extension,
    drawSelection: extension,
    dropCursor: extension,
    indentOnInput: extension,
    bracketMatching: extension,
    closeBrackets: extension,
    autocompletion: extension,
    highlightActiveLine: extension,
    highlightSelectionMatches: extension,
    rectangularSelection: extension,
    crosshairCursor: extension,
    search: extension,
    syntaxHighlighting: extension,
    keymap: { of: () => ({}) },
    indentUnit: { of: () => ({}) },
    closeSearchPanel: () => {},
    closeBracketsKeymap: [],
    defaultKeymap: [],
    searchKeymap: [],
    historyKeymap: [],
    foldKeymap: [],
    completionKeymap: [],
    indentWithTab: {},
    markdown: language,
    markdownLanguage: {},
    GFM: [],
    javascript: language,
    json: language,
    python: language,
    html: language,
    css: language,
    xml: language,
    yaml: language,
    sql: language,
    shell: {},
  }
}

/**
 * Load the entry module and every chunk in one vm context.
 *
 * @param options.files - virtual filesystem: absolute path -> content string.
 * @param options.sessions - sessions snapshot for the fake `ctx.sessions.list`.
 * @param options.fetch - optional fetch implementation; omit to disable editing.
 */
export function createHarness(options = {}) {
  const files = options.filesMap instanceof Map ? options.filesMap : new Map(Object.entries(options.files ?? {}))
  const versions = options.versionsMap instanceof Map ? options.versionsMap : new Map()
  const ops = { fetched: [], posts: [], saved: [], windows: [] }
  let versionSeq = 0
  if (options.versionsMap === undefined) {
    for (const path of files.keys()) versions.set(path, `v${++versionSeq}`)
  }

  const entryRegistrations = []
  const chunkRegistrations = new Map()

  const fakeDocument = options.document ?? {
    baseURI: 'https://dsh.test/',
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ setAttribute() {}, remove() {}, textContent: '' }),
    head: { append() {} },
  }
  const targetWindow = options.window ?? {
    location: { origin: 'https://dsh.test' },
    open: (url) => ops.windows.push(url),
    postMessage: () => {},
  }
  targetWindow.__ModuleLoader__ = {
    load(registration) {
      if (registration.chunk === undefined) entryRegistrations.push(registration)
      else chunkRegistrations.set(registration.chunk, registration)
    },
  }

  const sandbox = {
    ...(options.globals ?? {}),
    console,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    document: fakeDocument,
    URL,
    Blob,
    AbortController,
    fetch: options.fetch,
    indexedDB: options.indexedDB,
    document: fakeDocument,
    window: targetWindow,
  }
  vm.createContext(sandbox)

  const reactStub = {
    Fragment: Symbol('Fragment'),
    createElement(type, props, ...children) {
      const key = props !== null && props !== undefined ? props.key : undefined
      const nextProps = { ...(props ?? {}) }
      if (children.length === 0) nextProps.children = undefined
      else if (children.length === 1) nextProps.children = children[0]
      else nextProps.children = children
      return { type, props: nextProps, key }
    },
    useRef: (initial) => ({ current: initial }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: (fn) => {
      const cleanup = fn()
      if (typeof cleanup === 'function') {
        try {
          cleanup()
        } catch {
          // effects clean up on their own
        }
      }
    },
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  }
  const reactForElements = options.react ?? reactStub
  const element = (type, props, ...children) => reactForElements.createElement(type, props, ...children)
  const primitivesStub = {
    // Modal and the Markdown delegate keep their children, so the dialog tree
    // below them is actually walked by the shallow renderer.
    Modal: (props) => element('div', { className: props.className }, props.children),
    MarkdownDelegateProvider: (props) => element('div', null, props.children),
    Button: () => null,
    PathLabel: () => null,
    FileTypeIcon: () => null,
    StateDot: () => null,
    Toast: () => null,
    CodeBlock: () => null,
    MarkdownText: () => null,
    IconCloseOutlineRegular: () => null,
    IconEditOutlineRegular: () => null,
    IconRightUpOutlineRegular: () => null,
    IconFullscreenOutlineRegular: () => null,
    IconCompactOutlineRegular: () => null,
    languageForPath: () => 'javascript',
    fileSizeText: (bytes) => `${String(bytes)} B`,
  }
  const seed = {
    react: options.react ?? reactStub,
    '@deepseek-ai/dsh-client-ui-primitives': primitivesStub,
  }

  const materialized = new Map()
  // The vendored editor is stubbed by default; pass `codeMirror` to override.
  const stubChunks = options.realCodeMirror === true ? {} : { 'client.codemirror.js': options.codeMirror ?? createFakeCodeMirror() }

  function makeRequire() {
    const require = (specifier) => {
      if (seed[specifier] !== undefined) return seed[specifier]
      throw new Error(`harness: unexpected require("${specifier}")`)
    }
    require.async = async (specifier) => {
      if (!specifier.startsWith('./')) throw new Error(`harness: unexpected async require("${specifier}")`)
      const chunk = specifier.slice(2)
      if (materialized.has(chunk)) return materialized.get(chunk)
      if (stubChunks[chunk] !== undefined) {
        materialized.set(chunk, stubChunks[chunk])
        return stubChunks[chunk]
      }
      // The browser fetches and executes the chunk script on first request;
      // mirror that here so registration itself is under test.
      if (!chunkRegistrations.has(chunk)) {
        vm.runInContext(readFileSync(join(ROOT, chunk), 'utf8'), sandbox, { filename: chunk })
      }
      const registration = chunkRegistrations.get(chunk)
      if (registration === undefined) throw new Error(`harness: chunk ${chunk} did not register`)
      const exports = registration.factory(makeRequire())
      materialized.set(chunk, exports)
      return exports
    }
    return require
  }

  // Entry module first: it registers the factory, then the factory materializes.
  vm.runInContext(readFileSync(join(ROOT, 'client.js'), 'utf8'), sandbox, { filename: 'client.js' })
  if (entryRegistrations.length !== 1) throw new Error('client.js did not register exactly one entry factory')
  const pluginExports = entryRegistrations[0].factory(makeRequire())

  // ── Remote faces over the virtual filesystem ────────────────────────────
  const statCalls = []
  function stat(sessionId, path) {
    statCalls.push(path)
    if (!files.has(path)) return Promise.resolve({ ok: false, error: { code: 'workspace-file/not-found' } })
    const content = files.get(path)
    return Promise.resolve({
      ok: true,
      value: { absolutePath: path, version: versions.get(path), size: Buffer.byteLength(content, 'utf8') },
    })
  }

  function read(sessionId, path, range = {}) {
    if (!files.has(path)) return Promise.resolve({ ok: false, error: { code: 'workspace-file/not-found' } })
    const text = files.get(path)
    const lines = text.split('\n').length
    return Promise.resolve({
      ok: true,
      value: { text, lines, eof: true, version: versions.get(path), size: Buffer.byteLength(text, 'utf8') },
    })
  }

  function readBytes(sessionId, path) {
    if (!files.has(path)) return Promise.resolve({ ok: false, error: { code: 'workspace-file/not-found' } })
    return Promise.resolve({
      ok: true,
      value: { data: new TextEncoder().encode(files.get(path)), bytes: files.get(path).length, version: versions.get(path) },
    })
  }

  const workspaceFiles = { stat: (sessionId, path) => stat(sessionId, path), read, readBytes }

  let overlayComponent = null
  const ctx = {
    locale: {
      register: () => () => {},
      bind: () => translate,
    },
    effect: (fn) => {
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    slots: {
      inject: (_key, callback) => callback(),
      register: (_options, component) => {
        overlayComponent = component
        return () => {}
      },
    },
    sessions: {
      list: {
        getSnapshot: () =>
          options.sessions ?? {
            current: 'session-a',
            byId: { 'session-a': { cwd: '/project' } },
          },
      },
      open: () => {},
    },
    layout: { selectPanel: () => {} },
    sidebarRight: { mounted: { getSnapshot: () => undefined }, openResource: () => {} },
    remote: { workspaceFiles },
  }

  pluginExports.apply(ctx)
  let debug = sandbox.window.__dshThoughtdagFileOpen
  if (debug === undefined) throw new Error('apply() did not publish the debug handle')

  // ── shallow renderer ────────────────────────────────────────────────────
  // Executes every function component in the registered overlay once and
  // records the host-element classes it produced. It is not a DOM: string
  // elements are kept as plain nodes so a structural assertion can look for
  // the dialog chrome without a browser.
  function renderNode(node) {
    if (node === null || node === undefined || node === false || node === true) return null
    if (Array.isArray(node)) return node.map(renderNode).filter((child) => child !== null)
    if (typeof node !== 'object') return null
    const { type, props } = node
    if (typeof type === 'function') {
      const rendered = type(props ?? {})
      const result = renderNode(rendered)
      return result === null && props?.children !== undefined
        ? renderNode(props.children)
        : result
    }
    if (type === reactStub.Fragment) return renderNode(props?.children)
    if (typeof type === 'string') {
      return { type, className: props?.className, children: renderNode(props?.children) }
    }
    return null
  }

  function collectClasses(node, out = []) {
    if (node === null || node === undefined) return out
    if (Array.isArray(node)) {
      for (const child of node) collectClasses(child, out)
      return out
    }
    if (typeof node !== 'object') return out
    if (typeof node.className === 'string') out.push(node.className)
    collectClasses(node.children, out)
    return out
  }

  return {
    ctx,
    pluginExports,
    files,
    versions,
    ops,
    statCalls,
    debug: () => debug,
    sandbox,
    setFetch(fetchImpl) {
      sandbox.fetch = fetchImpl
    },
    /** The component the plugin registered into shell.overlay (for real-DOM tests). */
    overlay() {
      if (overlayComponent === null) throw new Error('harness: no overlay component was registered')
      return overlayComponent
    },
    /** Execute the registered overlay slot component once and return its rendered tree. */
    renderOverlay() {
      if (overlayComponent === null) throw new Error('harness: no overlay component was registered')
      return renderNode(reactStub.createElement(overlayComponent, null))
    },
    /** Flatten every host className produced by the last overlay render. */
    overlayClasses() {
      return collectClasses(this.renderOverlay())
    },
    /** The chunk exports after the entry's module loader has materialized them. */
    async chunk(name) {
      await sandbox.window.__dshThoughtdagFileOpen.ready()
      return makeRequire().async(`./${name}`)
    },
  }
}

/** Await one microtask/macrotask turn so chunk loading and tab fills settle. */
export function settle(ms = 5) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** JSON-response helper for fake fetch implementations. */
export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
