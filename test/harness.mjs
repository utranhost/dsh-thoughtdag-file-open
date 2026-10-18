// Shared fake-environment harness for the plugin's Node-side checks: it loads
// client.js in a vm sandbox with a fake window/document/React/primitives table,
// runs `apply`, and exposes the plugin's debug handle.
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const CODE = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

class FakeURL extends URL {
  static createObjectURL() {
    return 'blob:mock-url'
  }

  static revokeObjectURL() {}
}

const DEFAULT_LANGUAGE = {
  py: 'python',
  ts: 'typescript',
  js: 'javascript',
  json: 'json',
  yaml: 'yaml',
}

export function makeSandbox(options = {}) {
  const ops = { opened: [], panels: [], windows: [], revoked: 0, toastRenders: 0, disposers: [] }
  let loaded
  const documentOverrides = options.document ?? {}
  const document = {
    querySelector: documentOverrides.querySelector ?? (() => null),
    querySelectorAll: documentOverrides.querySelectorAll ?? (() => []),
    createElement: () => ({ setAttribute() {}, remove() {}, textContent: '' }),
    head: { append() {} },
  }
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    AbortController,
    Blob,
    setInterval: options.setInterval ?? (() => 1),
    clearInterval: () => {},
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    indexedDB: options.indexedDB,
    document,
    fetch: options.fetch ?? (async () => ({ ok: true, json: async () => ({ sessions: [] }) })),
    URL: FakeURL,
    window: {
      location: { origin: 'https://192.168.0.106:10443' },
      open: (url) => ops.windows.push(url),
      postMessage: () => {},
      __ModuleLoader__: {
        load(definition) {
          loaded = definition
        },
      },
    },
  }
  vm.createContext(sandbox)
  vm.runInContext(CODE, sandbox)
  if (loaded === undefined) throw new Error('client.js did not register a module factory')

  const component = (name) => {
    const Stub = () => null
    Stub.displayName = name
    return Stub
  }
  const primitives = {
    Modal: component('Modal'),
    Button: component('Button'),
    MarkdownText: component('MarkdownText'),
    MarkdownDelegateProvider: component('MarkdownDelegateProvider'),
    CodeBlock: component('CodeBlock'),
    PathLabel: component('PathLabel'),
    FileTypeIcon: component('FileTypeIcon'),
    StateDot: component('StateDot'),
    Toast: component('Toast'),
    languageForPath: options.languageForPath ?? ((path) => DEFAULT_LANGUAGE[String(path).split('.').pop()?.toLowerCase()]),
    fileSizeText: (bytes) => `${bytes}B`,
  }

  const ctx = {
    sessions: {
      list: {
        getSnapshot: () => options.sessions ?? { current: 'session-chat', byId: { 'session-chat': { cwd: '/data/dsh/home/聊天' } } },
      },
      open: (id) => ops.panels.push(['selectSession', id]),
    },
    layout: { selectPanel: (id) => ops.panels.push(['panel', id]) },
    remote: {
      workspaceFiles: options.workspaceFiles,
      ...(options.officeToPdf === undefined ? {} : { officeToPdf: options.officeToPdf }),
    },
    sidebarRight: {
      mounted: { getSnapshot: () => options.mounted ?? 'session-chat' },
      openResource: (address) => ops.opened.push(address),
    },
    locale: {
      register: () => {},
      bind: () => (key, params) => (params?.path === undefined ? key : `${key}:${params.path}`),
    },
    slots: { inject: () => {} },
    effect: (fn) => {
      const dispose = fn()
      if (typeof dispose === 'function') ops.disposers.push(dispose)
    },
  }

  const React = {
    createElement: () => null,
    Fragment: 'Fragment',
    useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
  }

  const module = loaded.factory((name) => {
    if (name === 'react') return React
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives
    throw new Error(`unexpected require: ${name}`)
  })
  module.apply(ctx)

  return { sandbox, module, ops, api: sandbox.window.__dshThoughtdagFileOpen }
}

// A workspaceFiles Remote fake over a simple path→content map.
export function fakeWorkspaceFiles(entries, options = {}) {
  const text = new Map()
  const bytes = new Map()
  const binary = new Set(options.binary ?? [])
  for (const [path, value] of Object.entries(entries)) {
    if (typeof value === 'string') text.set(path, value)
    else bytes.set(path, value)
  }
  const stat = async (sessionId, path) => {
    if (text.has(path) || bytes.has(path)) return { ok: true, value: { absolutePath: path, version: 'v1', bytes: (text.get(path) ?? bytes.get(path) ?? '').length } }
    return { ok: false, error: { code: 'workspace-file/not-found' } }
  }
  const read = async (sessionId, path, range = {}) => {
    if (binary.has(path)) return { ok: false, error: { code: 'workspace-file/not-text' } }
    if (!text.has(path)) return { ok: false, error: { code: 'workspace-file/not-found' } }
    const value = text.get(path)
    if (options.paged === true) {
      const offset = typeof range.offset === 'number' ? range.offset : 1
      const limit = options.pageLines ?? 2
      const lines = value.split('\n')
      const slice = lines.slice(offset - 1, offset - 1 + limit)
      return { ok: true, value: { absolutePath: path, version: 'v1', offset, text: slice.join('\n'), lines: slice.length, eof: offset - 1 + slice.length >= lines.length, bytes: value.length } }
    }
    return { ok: true, value: { absolutePath: path, version: 'v1', offset: 1, text: value, lines: value.split('\n').length, eof: true, bytes: value.length } }
  }
  const readBytes = async (sessionId, path) => {
    const value = bytes.get(path) ?? text.get(path)
    if (value === undefined) return { ok: false, error: { code: 'workspace-file/not-found' } }
    const data = typeof value === 'string' ? new Uint8Array(Buffer.from(value)) : new Uint8Array(value)
    return { ok: true, value: { absolutePath: path, version: 'v1', offset: 0, data, eof: true, bytes: data.length } }
  }
  return { stat, read, readBytes }
}

export function fakeOfficeToPdf(result) {
  return {
    render: async (sessionId, path, priority, signal) => result ?? { ok: true, value: { absolutePath: path, version: 'v1', offset: 0, data: new Uint8Array(Buffer.from('%PDF-1.4')), eof: true, bytes: 8, missingFonts: [], generation: 'g1' } },
  }
}

export function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`)
  console.log(`ok - ${message}`)
}

export async function waiting(check, message, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`FAIL: timed out waiting for ${message}`)
}
