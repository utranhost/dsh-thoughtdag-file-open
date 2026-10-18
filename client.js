// @local/dsh-thoughtdag-file-open — Client half.
//
// ThoughtDAG's canvas renders Markdown links as ordinary anchors inside its
// same-origin iframe: a relative href such as `docs/product/status.md` resolves
// against `/thoughtdag/` and the canvas navigates to a URL the SPA cannot
// render. This module keeps the click where it is and shows the file in an
// in-page modal over the canvas, rendered with the harness's own UI primitives
// (the same Markdown/code renderers the chat uses). Ordinary HTTP(S) links are
// never touched.
//
// It resolves the href to a real file through the harness, reads it through the
// session-authorised workspace endpoint, and renders by kind: Markdown, code /
// text, images, PDF, HTML (sandboxed), and Office documents (via the host's
// Office→PDF conversion). Anything it cannot render falls back to a button that
// opens the file in the harness's own document window.
window.__ModuleLoader__.load({
  id: '@local/dsh-thoughtdag-file-open',
  factory(require) {
    const React = require('react')
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    const module = { exports: {} }

    const { Modal, Button, MarkdownText, MarkdownDelegateProvider, CodeBlock, PathLabel, FileTypeIcon, StateDot, languageForPath, fileSizeText, Toast } = primitives

    const NS = '@local/dsh-thoughtdag-file-open'
    const VERSION = '2.2.0'
    const TOAST_MS = 6000
    const RESOLVE_TIMEOUT_MS = 4000
    const OPEN_TIMEOUT_MS = 3000
    const MAX_STAT_SESSIONS = 24
    const MAX_BASES = 32
    const MAX_TEXT_PAGES = 6
    // Keep the code viewer responsive: Shiki highlights the whole buffer.
    const MAX_CODE_CHARS = 150000
    const MAX_MARKDOWN_CHARS = 400000
    // ── kinds this viewer renders ───────────────────────────────────────────
    const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdown', 'mkd', 'mkdn', 'mdwn'])
    const IMAGE_MIME = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      bmp: 'image/bmp',
      ico: 'image/x-icon',
      svg: 'image/svg+xml',
      avif: 'image/avif',
      apng: 'image/apng',
      tif: 'image/tiff',
      tiff: 'image/tiff',
    }
    const PDF_EXTENSIONS = new Set(['pdf'])
    const HTML_EXTENSIONS = new Set(['html', 'htm', 'xhtml'])
    // Every target the host's office-to-pdf provider accepts.
    const OFFICE_EXTENSIONS = new Set(['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'])
    // Extension-less links are only taken over for names that are plainly files.
    const BARE_FILE_NAMES = new Set(['dockerfile', 'containerfile', 'makefile', 'rakefile', 'gemfile', 'procfile', 'brewfile', 'license', 'licence', 'notice', 'copying', 'readme', 'changelog', 'authors', 'contributing', 'go.mod', 'go.sum', 'cargo.lock'])
    const DIR_KEY = /(?:agentcwd|cwd|workingdir|workspacedir|basedir|rootdir|directory|folder|dir)$/i

    // ── small path helpers ─────────────────────────────────────────────────
    function encodeSegment(segment) {
      return encodeURIComponent(segment).replace(/%3A/gi, ':')
    }

    function sessionFileAddress(sessionId, path) {
      const normalized = String(path).replace(/\\/g, '/').replace(/^(?:\.\/)+/, '')
      return `dsh-resource://file/session/${encodeSegment(sessionId)}/${normalized
        .split('/')
        .map(encodeSegment)
        .join('/')}`
    }

    function isAbsolutePath(value) {
      return value.startsWith('/') || value.startsWith('\\\\') || /^[A-Za-z]:[\\/]/.test(value)
    }

    // DSH normalizes backslashes to forward slashes when it addresses a file, so
    // the viewer does the same for every path it resolves; POSIX paths are
    // untouched apart from their separators.
    function normalizeTargetPath(value) {
      return String(value).replace(/\\/g, '/')
    }

    function joinPath(base, path) {
      if (isAbsolutePath(path)) return normalizeTargetPath(path)
      const root = normalizeTargetPath(base).replace(/\/+$/, '')
      if (root === '') return normalizeTargetPath(path)
      return `${root}/${normalizeTargetPath(path).replace(/^\/+/, '')}`
    }

    function basenameOf(path) {
      const normalized = String(path).replace(/\\/g, '/').replace(/\/+$/, '')
      const cut = normalized.lastIndexOf('/')
      return cut === -1 ? normalized : normalized.slice(cut + 1)
    }

    function dirnameOf(path) {
      const normalized = String(path).replace(/\\/g, '/').replace(/\/+$/, '')
      const cut = normalized.lastIndexOf('/')
      return cut <= 0 ? '/' : normalized.slice(0, cut)
    }

    function extensionOf(path) {
      const base = basenameOf(path)
      const dot = base.lastIndexOf('.')
      return dot <= 0 || dot === base.length - 1 ? '' : base.slice(dot + 1).toLowerCase()
    }

    function decodeLoose(text) {
      try {
        return decodeURIComponent(text)
      } catch {
        return text
      }
    }

    // A file link may name a line either GitHub-style (`file.md#L92`,
    // `#L92-L99`) or as a trailing colon form (`file.dos:48`, also `:48:7` for
    // line:column). Both are line targets on the same file: the path itself is
    // resolved without the suffix.
    function lineFromFragment(fragment) {
      if (typeof fragment !== 'string') return undefined
      const value = fragment.trim()
      const range = /^L(\d{1,7})(?:-L?(\d{1,7}))?$/.exec(value)
      if (range !== null) return Number(range[1])
      const plain = /^(\d{1,7})$/.exec(value)
      return plain === null ? undefined : Number(plain[1])
    }

    function splitLineSuffix(path) {
      const value = String(path)
      // Non-greedy so `file.py:12:5` splits as (file.py, 12, 5) rather than as a
      // line target on a name that merely ends in `:12`.
      const match = /^(.*?):(\d{1,7})(?::\d{1,7})?$/.exec(value)
      if (match === null) return { path: value, line: undefined }
      const base = match[1]
      const extension = extensionOf(base)
      const looksLikeFile = (extension !== '' && /^[a-z][a-z0-9]{0,9}$/.test(extension)) || BARE_FILE_NAMES.has(basenameOf(base).toLowerCase())
      if (!looksLikeFile) return { path: value, line: undefined }
      return { path: base, line: Number(match[2]) }
    }

    function fileInfo(path) {
      const extension = extensionOf(path)
      if (MARKDOWN_EXTENSIONS.has(extension)) return { kind: 'markdown' }
      if (IMAGE_MIME[extension] !== undefined) return { kind: 'image', mime: IMAGE_MIME[extension] }
      if (PDF_EXTENSIONS.has(extension)) return { kind: 'pdf' }
      if (HTML_EXTENSIONS.has(extension)) return { kind: 'html' }
      if (OFFICE_EXTENSIONS.has(extension)) return { kind: 'office' }
      return { kind: 'auto', language: languageForPath(path) }
    }

    // ── link classification ────────────────────────────────────────────────
    // Returns null for everything the plugin must leave alone: HTTP(S) links
    // keep their ordinary browser behaviour, as do in-app hash routes and every
    // non-file scheme.
    // `file:` URLs: POSIX (`file:///a/b`), Windows drive (`file:///C:/a/b`) and
    // UNC (`file://server/share/a/b`) all reduce to a host path.
    function parseFileURL(raw) {
      let path
      try {
        const url = new URL(raw)
        const pathname = decodeLoose(url.pathname)
        path = url.host === '' ? pathname : `//${url.host}${pathname}`
      } catch {
        path = decodeLoose(raw.replace(/^file:\/\//i, ''))
        if (!path.startsWith('/')) path = `/${path}`
      }
      if (/^\/[A-Za-z]:[\\/]/.test(path)) path = path.slice(1)
      return path === '' ? null : path
    }

    function classifyHref(href) {
      const raw = String(href).trim()
      if (raw === '' || raw.startsWith('#')) return null
      // A Windows drive path (`C:\dir\file.md`) is a file, not a URL scheme.
      const windowsAbsolute = /^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith('\\\\')
      if (!windowsAbsolute) {
        if (/^(?:[a-z][a-z0-9+.-]*:)/i.test(raw) && !/^file:/i.test(raw)) return null
        if (raw.startsWith('//')) return null
      }
      let path
      let fragment
      if (/^file:/i.test(raw)) {
        const hashAt = raw.indexOf('#')
        if (hashAt !== -1) fragment = decodeLoose(raw.slice(hashAt + 1))
        path = parseFileURL(hashAt === -1 ? raw : raw.slice(0, hashAt))
        if (path === null) return null
      } else {
        const hashAt = raw.indexOf('#')
        if (hashAt !== -1) {
          fragment = decodeLoose(raw.slice(hashAt + 1))
          path = decodeLoose(raw.slice(0, hashAt).split('?')[0])
        } else {
          path = decodeLoose(raw.split('?')[0])
        }
      }
      path = normalizeTargetPath(path)
      if (path === '') return null
      const suffix = splitLineSuffix(path)
      const clean = suffix.path
      const extension = extensionOf(clean)
      const looksLikeFile = (extension !== '' && /^[a-z][a-z0-9]{0,9}$/.test(extension)) || BARE_FILE_NAMES.has(basenameOf(clean).toLowerCase()) || isAbsolutePath(clean)
      if (!looksLikeFile) return null
      return { path: clean, absolute: isAbsolutePath(clean), line: lineFromFragment(fragment) ?? suffix.line }
    }

    // ── async helpers ──────────────────────────────────────────────────────
    function withTimeout(promise, ms, fallback) {
      return new Promise((resolve) => {
        let settled = false
        const finish = (value) => {
          if (settled) return
          settled = true
          resolve(value)
        }
        const timer = setTimeout(() => finish(fallback), ms)
        Promise.resolve(promise).then(
          (value) => {
            clearTimeout(timer)
            finish(value)
          },
          () => {
            clearTimeout(timer)
            finish(fallback)
          },
        )
      })
    }

    function callRemote(namespace, method, args) {
      return new Promise((resolve) => {
        try {
          if (namespace === null || namespace === undefined || typeof namespace[method] !== 'function') {
            resolve({ ok: false, error: { code: 'client/no-remote' } })
            return
          }
          const pending = namespace[method](...args)
          if (pending !== null && typeof pending === 'object' && typeof pending.then === 'function') {
            pending.then(
              (result) => resolve(result !== null && typeof result === 'object' ? result : { ok: false, error: { code: 'client/bad-result' } }),
              (error) => resolve({ ok: false, error: { code: 'client/call-failed', message: error instanceof Error ? error.message : String(error) } }),
            )
          } else {
            resolve(pending !== null && typeof pending === 'object' ? pending : { ok: false, error: { code: 'client/bad-result' } })
          }
        } catch (error) {
          resolve({ ok: false, error: { code: 'client/call-failed', message: error instanceof Error ? error.message : String(error) } })
        }
      })
    }

    async function statRemote(ctx, sessionId, path) {
      const result = await callRemote(ctx.remote.workspaceFiles, 'stat', [sessionId, path])
      return result.ok === true && result.value !== null && typeof result.value === 'object' && typeof result.value.absolutePath === 'string' ? result.value : null
    }

    async function readTextRemote(ctx, sessionId, path, signal, maxChars) {
      let offset = 1
      let text = ''
      for (let page = 0; page < MAX_TEXT_PAGES; page += 1) {
        const result = await callRemote(ctx.remote.workspaceFiles, 'read', [sessionId, path, { offset }, signal])
        if (result.ok !== true) {
          const code = result.error?.code ?? 'workspace-file/read-failed'
          return { ok: false, code }
        }
        const value = result.value ?? {}
        if (page > 0 && typeof value.text === 'string' && value.text !== '') text += '\n'
        if (typeof value.text === 'string') text += value.text
        if (value.eof === true) return { ok: true, text, truncated: false }
        const lines = typeof value.lines === 'number' ? value.lines : 0
        if (lines === 0 || text.length >= maxChars) return { ok: true, text, truncated: true }
        offset += lines
      }
      return { ok: true, text, truncated: true }
    }

    // ── sources of a working directory ─────────────────────────────────────
    function sessionSnapshot(ctx) {
      let snapshot
      try {
        snapshot = ctx.sessions.list.getSnapshot()
      } catch {
        snapshot = null
      }
      const byId = snapshot !== null && typeof snapshot === 'object' && typeof snapshot.byId === 'object' && snapshot.byId !== null ? snapshot.byId : {}
      const ids = Object.keys(byId)
      const currentId = typeof snapshot?.current === 'string' ? snapshot.current : undefined
      const ordered = currentId !== undefined && ids.includes(currentId) ? [currentId, ...ids.filter((id) => id !== currentId)] : ids
      const sessions = []
      for (const id of ordered) {
        const row = byId[id]
        const cwd = typeof row?.cwd === 'string' && row.cwd !== '' ? row.cwd : undefined
        sessions.push({ id, cwd })
        if (sessions.length >= MAX_STAT_SESSIONS) break
      }
      return { currentId, sessions }
    }

    function currentSessionId(ctx) {
      try {
        const id = ctx.sessions.list.getSnapshot().current
        return typeof id === 'string' ? id : undefined
      } catch {
        return undefined
      }
    }

    // The ThoughtDAG host half serves the canvas SPA and the session bridge under
    // the mount prefix; read it from the iframe the host half created.
    function thoughtdagMount() {
      const frames = document.querySelectorAll('[data-dsh-thoughtdag] iframe')
      for (const frame of frames) {
        const source = frame.dataset?.src ?? frame.getAttribute('src') ?? ''
        if (typeof source !== 'string' || source === '') continue
        try {
          const url = new URL(source, window.location.origin)
          return url.href.replace(/\/?$/, '/')
        } catch {
          continue
        }
      }
      return '/thoughtdag/'
    }

    async function diskSessions() {
      try {
        const response = await fetch(`${thoughtdagMount()}api/disksessions`, { headers: { accept: 'application/json' } })
        if (!response.ok) return []
        const body = await response.json()
        return Array.isArray(body?.sessions) ? body.sessions : []
      } catch {
        return []
      }
    }

    // The canvas keeps its project (and that project's working directory) in the
    // embedded SPA's persisted store — idb-keyval's `keyval-store`/`keyval`.
    // Returns the active project's own directory first, then every other
    // directory-looking value. Read without ever creating the database:
    // `indexedDB.databases()` proves it exists before the versioned open.
    const persistedCache = { at: 0, value: null }
    const PERSISTED_CACHE_MS = 15000

    function collectPersistedDirs(values) {
      const preferred = []
      const dirs = new Set()
      let budget = 20000
      const takeDir = (candidate) => {
        if (typeof candidate !== 'string' || /[\u0000-\u001f]/.test(candidate) || candidate.length >= 1024) return undefined
        const normalized = normalizeTargetPath(candidate).replace(/\/+$/, '')
        if (/^[A-Za-z]:$/.test(normalized)) return normalized
        return isAbsolutePath(normalized) && normalized !== '' ? normalized : undefined
      }
      const visit = (value, key, depth) => {
        if (budget <= 0 || depth > 8 || value === null || value === undefined) return
        budget -= 1
        if (typeof value === 'string') {
          if (key !== null && key !== undefined && DIR_KEY.test(key) && dirs.size < MAX_BASES) {
            const dir = takeDir(value)
            if (dir !== undefined && dir !== '') dirs.add(dir)
          }
          return
        }
        if (Array.isArray(value)) {
          for (const item of value) visit(item, key, depth + 1)
          return
        }
        if (typeof value !== 'object') return
        if (typeof value.activeId === 'string' && Array.isArray(value.projects)) {
          const active = value.projects.find((project) => project !== null && typeof project === 'object' && project.id === value.activeId)
          if (active !== null && typeof active === 'object') {
            for (const field of ['agentCwd', 'cwd', 'workingDir', 'rootDir']) {
              const dir = takeDir(active[field])
              if (dir !== undefined && dir !== '' && !preferred.includes(dir)) preferred.push(dir)
            }
          }
        }
        for (const [childKey, childValue] of Object.entries(value)) visit(childValue, childKey, depth + 1)
      }
      for (const value of values) visit(value, null, 0)
      return { preferred, dirs: [...dirs] }
    }

    async function readPersistedDirs() {
      try {
        if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') return { preferred: [], dirs: [] }
        const databases = await indexedDB.databases()
        const info = Array.isArray(databases) ? databases.find((entry) => entry?.name === 'keyval-store') : undefined
        if (info === undefined) return { preferred: [], dirs: [] }
        const db = await new Promise((resolve, reject) => {
          const request = typeof info.version === 'number' ? indexedDB.open('keyval-store', info.version) : indexedDB.open('keyval-store')
          request.onerror = () => reject(request.error)
          request.onupgradeneeded = () => {
            try {
              request.transaction?.abort()
            } catch {
              // the fallback is optional
            }
          }
          request.onsuccess = () => resolve(request.result)
        })
        try {
          if (!db.objectStoreNames.contains('keyval')) return { preferred: [], dirs: [] }
          const values = await new Promise((resolve) => {
            try {
              const store = db.transaction('keyval', 'readonly').objectStore('keyval')
              const all = store.getAll()
              all.onerror = () => resolve([])
              all.onsuccess = () => resolve(Array.isArray(all.result) ? all.result : [])
            } catch {
              resolve([])
            }
          })
          return collectPersistedDirs(values)
        } finally {
          try {
            db.close()
          } catch {
            // already closed
          }
        }
      } catch {
        return { preferred: [], dirs: [] }
      }
    }

    async function canvasProjectDirs() {
      if (persistedCache.value !== null && Date.now() - persistedCache.at < PERSISTED_CACHE_MS) return persistedCache.value
      const value = await readPersistedDirs()
      if (value.preferred.length > 0 || value.dirs.length > 0) {
        persistedCache.value = value
        persistedCache.at = Date.now()
      }
      return value
    }

    // ── resolution ─────────────────────────────────────────────────────────
    // Resolve a clicked/linked href to `{ sessionId, absolutePath }`, or null.
    async function resolveTarget(ctx, target, extraBases) {
      const snapshot = sessionSnapshot(ctx)
      const authorizers = []
      if (snapshot.currentId !== undefined) authorizers.push(snapshot.currentId)
      for (const session of snapshot.sessions) if (!authorizers.includes(session.id)) authorizers.push(session.id)

      const disk = await withTimeout(diskSessions(), RESOLVE_TIMEOUT_MS, [])
      for (const row of disk) if (typeof row?.id === 'string' && row.id !== '' && !authorizers.includes(row.id)) authorizers.push(row.id)
      const authorizer = authorizers[0]
      if (authorizer === undefined) return null

      const wanted = normalizeTargetPath(target.path)
      if (isAbsolutePath(wanted)) {
        const hit = await statRemote(ctx, authorizer, wanted)
        return hit === null ? null : { sessionId: authorizer, absolutePath: typeof hit.absolutePath === 'string' ? hit.absolutePath : wanted }
      }

      const persisted = await withTimeout(canvasProjectDirs(), 1200, { preferred: [], dirs: [] })
      const bases = []
      const seen = new Set()
      const push = (candidate) => {
        if (typeof candidate !== 'string' || candidate === '') return
        const normalized = normalizeTargetPath(candidate).replace(/\/+$/, '')
        // Keep a bare drive root (`C:`): joining it with `joinPath` restores it.
        const usable = /^[A-Za-z]:$/.test(normalized) ? normalized : isAbsolutePath(normalized) ? normalized : ''
        if (usable === '' || seen.has(usable)) return
        seen.add(usable)
        bases.push(usable)
      }
      // A link inside a previewed document resolves against that document's own
      // directory first, then the canvas's project folder, then the sessions.
      for (const dir of extraBases) push(dir)
      for (const dir of persisted.preferred) push(dir)
      for (const session of snapshot.sessions) push(session.cwd)
      for (const row of disk) push(row?.cwd)
      for (const dir of persisted.dirs) push(dir)

      const attempts = bases.slice(0, MAX_BASES).map(async (base) => {
        const absolutePath = joinPath(base, wanted)
        const hit = await statRemote(ctx, authorizer, absolutePath)
        return hit === null ? null : { sessionId: authorizer, absolutePath: typeof hit.absolutePath === 'string' ? hit.absolutePath : absolutePath }
      })
      const settled = await withTimeout(Promise.all(attempts), RESOLVE_TIMEOUT_MS, [])
      return Array.isArray(settled) ? settled.find((hit) => hit !== null && hit !== undefined) ?? null : null
    }

    // ── the in-page viewer state ───────────────────────────────────────────
    const viewer = { state: null, token: 0, controller: null, listeners: new Set() }

    function getViewer() {
      return viewer.state
    }

    function subscribeViewer(listener) {
      viewer.listeners.add(listener)
      return () => {
        viewer.listeners.delete(listener)
      }
    }

    function emitViewer() {
      for (const listener of [...viewer.listeners]) {
        try {
          listener()
        } catch {
          // a broken listener must not break the others
        }
      }
    }

    function patchViewer(patch) {
      if (viewer.state === null) return
      viewer.state = { ...viewer.state, ...patch }
      emitViewer()
    }

    function closeViewer() {
      const previous = viewer.state
      viewer.token += 1
      try {
        viewer.controller?.abort()
      } catch {
        // already aborted
      }
      viewer.controller = null
      viewer.state = null
      if (previous !== null && previous.url !== undefined) {
        try {
          URL.revokeObjectURL(previous.url)
        } catch {
          // already revoked
        }
      }
      emitViewer()
    }

    async function openViewerFile(ctx, hit, line) {
      closeViewer()
      const token = ++viewer.token
      const controller = new AbortController()
      viewer.controller = controller
      const fileName = basenameOf(hit.absolutePath)
      const info = fileInfo(hit.absolutePath)
      const targetLine = typeof line === 'number' && Number.isFinite(line) && line > 0 ? Math.floor(line) : undefined
      viewer.state = {
        fileName,
        absolutePath: hit.absolutePath,
        sessionId: hit.sessionId,
        phase: 'loading',
        kind: info.kind === 'auto' ? 'code' : info.kind,
        origin: info.kind,
        line: targetLine,
      }
      emitViewer()
      try {
        if (info.kind === 'image' || info.kind === 'pdf' || info.kind === 'html') {
          const result = await callRemote(ctx.remote.workspaceFiles, 'readBytes', [hit.sessionId, hit.absolutePath, {}, controller.signal])
          if (token !== viewer.token) return
          if (result.ok !== true) {
            patchViewer({ phase: 'ready', kind: 'unsupported', reason: 'readFailed' })
            return
          }
          const data = result.value?.data
          const mime = info.kind === 'image' ? info.mime : info.kind === 'pdf' ? 'application/pdf' : 'text/html'
          const url = URL.createObjectURL(new Blob([data], { type: mime }))
          patchViewer({ phase: 'ready', kind: info.kind, url, bytes: result.value?.bytes })
          return
        }
        if (info.kind === 'office') {
          if (ctx.remote?.officeToPdf === undefined) {
            patchViewer({ phase: 'ready', kind: 'unsupported', reason: 'office' })
            return
          }
          const result = await callRemote(ctx.remote.officeToPdf, 'render', [hit.sessionId, hit.absolutePath, 'foreground', controller.signal])
          if (token !== viewer.token) return
          if (result.ok !== true) {
            patchViewer({ phase: 'ready', kind: 'unsupported', reason: 'office' })
            return
          }
          const url = URL.createObjectURL(new Blob([result.value?.data], { type: 'application/pdf' }))
          patchViewer({ phase: 'ready', kind: 'pdf', origin: 'office', url, bytes: result.value?.bytes })
          return
        }
        const read = await readTextRemote(ctx, hit.sessionId, hit.absolutePath, controller.signal, info.kind === 'markdown' ? MAX_MARKDOWN_CHARS : MAX_CODE_CHARS)
        if (token !== viewer.token) return
        if (read.ok !== true) {
          patchViewer({ phase: 'ready', kind: 'unsupported', reason: read.code === 'workspace-file/too-large' ? 'tooLarge' : read.code === 'workspace-file/not-text' ? 'binary' : 'readFailed' })
          return
        }
        patchViewer({ kind: info.kind === 'markdown' ? 'markdown' : 'code', phase: 'ready', text: read.text, truncated: read.truncated === true, language: info.language })
      } catch (error) {
        if (token !== viewer.token) return
        patchViewer({ phase: 'error', error: error instanceof Error ? error.message : String(error) })
      }
    }

    // ── open in the harness's own document window (fallback) ──────────────
    function readMounted(ctx) {
      try {
        return ctx.sidebarRight?.mounted?.getSnapshot?.()
      } catch {
        return undefined
      }
    }

    function selectSession(ctx, sessionId) {
      const sessions = ctx.sessions
      const select = sessions?.open ?? sessions?.select
      if (typeof select !== 'function') return false
      try {
        select.call(sessions, sessionId)
        return true
      } catch {
        return false
      }
    }

    function dismissCanvasOverlay() {
      try {
        window.postMessage({ source: 'dsh-thoughtdag', type: 'td:close' }, window.location.origin)
      } catch {
        // no listener: nothing to dismiss
      }
    }

    function openDocumentTab(ctx, sessionId, address) {
      return new Promise((resolve) => {
        const deadline = Date.now() + OPEN_TIMEOUT_MS
        const attempt = () => {
          if (readMounted(ctx) === sessionId) {
            try {
              ctx.sidebarRight.openResource(address)
              resolve(true)
              return
            } catch {
              // surface not adopted yet; retry on the next frame
            }
          }
          if (Date.now() >= deadline) {
            resolve(false)
            return
          }
          requestAnimationFrame(attempt)
        }
        attempt()
      })
    }

    async function openInDsWindow(ctx, hit) {
      let sessionId = currentSessionId(ctx)
      if (sessionId === undefined) {
        sessionId = hit.sessionId
        selectSession(ctx, sessionId)
      }
      try {
        ctx.layout.selectPanel('conversation')
      } catch {
        try {
          ctx.layout.selectPanel(null)
        } catch {
          // the host keeps its layout
        }
      }
      const address = sessionFileAddress(sessionId, hit.absolutePath)
      if (await openDocumentTab(ctx, sessionId, address)) return true
      dismissCanvasOverlay()
      return openDocumentTab(ctx, sessionId, address)
    }

    // ── toast ──────────────────────────────────────────────────────────────
    const toastState = { current: null, seq: 0, listeners: new Set() }

    function subscribeToast(listener) {
      toastState.listeners.add(listener)
      return () => {
        toastState.listeners.delete(listener)
      }
    }

    function readToast() {
      return toastState.current
    }

    function emitToast() {
      for (const listener of [...toastState.listeners]) {
        try {
          listener()
        } catch {
          // ignore
        }
      }
    }

    function showToast(text) {
      if (typeof text !== 'string' || text === '') return
      toastState.seq += 1
      toastState.current = { text, seq: toastState.seq }
      emitToast()
    }

    // ── stylesheet (owned by this plugin, removed with it) ─────────────────
    const CSS = `
.dsh-tdfi-dialog.dsh-tdfi-dialog{width:min(1080px,94vw)!important;max-height:min(92vh,100%)!important;gap:16px}
.dsh-tdfi-content.dsh-tdfi-content{overflow:auto;min-height:0;max-height:calc(92vh - 200px)}
.dsh-tdfi-head{display:flex;align-items:center;gap:10px;min-width:0}
.dsh-tdfi-path{min-width:0;flex:1;font-size:12px}
.dsh-tdfi-meta{flex:none;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dsh-tdfi-loading{display:flex;align-items:center;gap:10px;padding:22px 0;font-size:13px;color:var(--dsw-alias-label-secondary)}
.dsh-tdfi-md{padding:4px 0 18px;min-width:0}
.dsh-tdfi-code{padding:4px 0 18px;min-width:0}
.dsh-tdfi-image{display:flex;align-items:center;justify-content:center;padding:4px 0 18px}
.dsh-tdfi-image img{max-width:100%;max-height:calc(92vh - 270px);border-radius:8px;object-fit:contain}
.dsh-tdfi-frame{display:block;width:100%;height:calc(92vh - 270px);border:0;border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.dsh-tdfi-unsupported{display:flex;flex-direction:column;align-items:center;gap:14px;padding:32px 0;text-align:center;font-size:13px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.dsh-tdfi-note{padding:0 0 14px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dsh-tdfi-error{padding:18px 0;font-size:13px;line-height:1.6;color:var(--dsw-alias-state-error-primary)}
`

    // ── click bridge over the canvas iframe ────────────────────────────────
    function handleCanvasClick(event, openTarget) {
      if (event.defaultPrevented) return
      if (typeof event.button === 'number' && event.button !== 0) return
      const target = event.target
      const element = target !== null && target !== undefined && target.nodeType === 1 ? target : target?.parentElement
      const anchor = element !== null && element !== undefined && typeof element.closest === 'function' ? element.closest('a[href]') : null
      if (anchor === null || anchor === undefined) return
      const classified = classifyHref(anchor.getAttribute('href') ?? '')
      if (classified === null) return
      event.preventDefault()
      event.stopPropagation()
      openTarget(classified)
    }

    function installFrameBridge(ctx, openTarget) {
      let bound
      let timer = 0

      const unbind = () => {
        if (bound === undefined) return
        try {
          bound.frame.removeEventListener('load', bound.onLoad)
        } catch {
          // frame gone
        }
        try {
          bound.doc?.removeEventListener('click', bound.onClick, true)
        } catch {
          // document gone
        }
        bound = undefined
      }

      const bind = (frame) => {
        if (bound !== undefined && bound.frame === frame) return
        unbind()
        const entry = { frame, doc: null, onClick: null, onLoad: null }
        const attach = () => {
          let doc = null
          try {
            doc = entry.frame.contentDocument
          } catch {
            doc = null
          }
          if (doc === null) return
          if (entry.doc === doc) return
          if (entry.doc !== null) {
            try {
              entry.doc.removeEventListener('click', entry.onClick, true)
            } catch {
              // replaced document
            }
          }
          entry.doc = doc
          try {
            doc.addEventListener('click', entry.onClick, true)
          } catch {
            entry.doc = null
          }
        }
        entry.onClick = (event) => handleCanvasClick(event, openTarget)
        entry.onLoad = () => attach()
        try {
          frame.addEventListener('load', entry.onLoad)
        } catch {
          // detached frame
        }
        attach()
        bound = entry
      }

      const find = () => {
        const frame = document.querySelector('[data-dsh-thoughtdag] iframe')
        if (frame === null) return
        bind(frame)
        if (bound !== undefined && bound.doc !== null && timer !== 0) {
          clearInterval(timer)
          timer = 0
        }
      }

      find()
      if (timer === 0) timer = setInterval(find, 1000)
      return () => {
        if (timer !== 0) clearInterval(timer)
        timer = 0
        unbind()
      }
    }

    // ── plugin body ────────────────────────────────────────────────────────
    module.exports.inject = ['sessions', 'layout', 'remote', 'remote.workspaceFiles', 'sidebarRight', 'locale', 'slots']
    module.exports.apply = (ctx) => {
      ctx.effect(
        () =>
          ctx.locale.register(NS, {
            zh: {
              loading: '正在加载文件…',
              close: '关闭',
              copy: '复制',
              copied: '已复制',
              code: '代码',
              wrap: '自动换行',
              unwrap: '不换行',
              footnotes: '脚注',
              truncated: '文件较大，这里只显示前面的内容。',
              unresolved: '找不到这个文件：{path}\n请确认画布的工作目录后重试。',
              unsupportedBinary: '这个文件是二进制或暂不支持的格式，无法在这里预览。',
              unsupportedOffice: '这个 Office 文件无法转换预览，可以在 DSH 的文件窗口中打开。',
              unsupportedTooLarge: '文件太大，无法在这里预览。',
              unsupportedReadFailed: '读取这个文件失败。',
              error: '打开这个文件时出错。',
              line: '第 {line} 行',
              openInWindow: '在文件窗口打开',
            },
            en: {
              loading: 'Loading file…',
              close: 'Close',
              copy: 'Copy',
              copied: 'Copied',
              code: 'Code',
              wrap: 'Wrap',
              unwrap: 'No wrap',
              footnotes: 'Footnotes',
              truncated: 'This file is large; only the beginning is shown.',
              unresolved: 'Could not find this file: {path}\nCheck the canvas working directory and try again.',
              unsupportedBinary: 'This file is binary or in a format the in-page viewer does not support.',
              unsupportedOffice: 'This Office document could not be converted for preview; open it in DSH’s document window instead.',
              unsupportedTooLarge: 'This file is too large to preview here.',
              unsupportedReadFailed: 'Reading this file failed.',
              error: 'Opening this file failed.',
              line: 'Line {line}',
              openInWindow: 'Open in document window',
            },
          }),
        'dsh-thoughtdag-file-open: dictionaries',
      )
      const t = ctx.locale.bind(NS)

      ctx.effect(() => {
        const style = document.createElement('style')
        style.setAttribute('data-plugin', NS)
        style.textContent = CSS
        document.head.append(style)
        return () => {
          style.remove()
        }
      }, 'dsh-thoughtdag-file-open: stylesheet')

      const codeToolbarLabels = () => ({ codeLabel: t('code'), wrapLabel: t('wrap'), unwrapLabel: t('unwrap') })
      const markdownLabels = () => ({ code: { copyLabel: t('copy'), copiedLabel: t('copied'), toolbarLabels: codeToolbarLabels() }, footnotes: t('footnotes') })

      const openExternalLink = (url) => {
        try {
          window.open(url, '_blank', 'noopener,noreferrer')
        } catch {
          // a blocked popup leaves the page where it is
        }
      }

      const openLinkedFile = (state, path, options) => {
        const raw = String(path)
        const hashAt = raw.indexOf('#')
        const fragment = hashAt === -1 ? undefined : raw.slice(hashAt + 1)
        const destination = raw.slice(0, hashAt === -1 ? raw.length : hashAt).split('?')[0]
        if (destination === '') return
        const normalized = normalizeTargetPath(destination)
        const suffix = splitLineSuffix(normalized)
        const line = options?.line ?? lineFromFragment(fragment) ?? suffix.line
        resolveTarget(ctx, { path: suffix.path, absolute: isAbsolutePath(suffix.path) }, [dirnameOf(state.absolutePath)])
          .then((hit) => {
            if (hit === null) {
              showToast(t('unresolved', { path: suffix.path }))
              return null
            }
            return openViewerFile(ctx, hit, line)
          })
          .catch(() => showToast(t('error')))
      }

      const pathImagesFor = (state) => ({
        resolve(value) {
          const clean = normalizeTargetPath(decodeLoose(String(value).split(/[?#]/)[0]))
          if (clean === '') return undefined
          const absolute = isAbsolutePath(clean) ? clean : joinPath(dirnameOf(state.absolutePath), clean)
          if (!isAbsolutePath(absolute)) return undefined
          try {
            return new URL(`api/file?path=${encodeURIComponent(absolute)}`, document.baseURI).href
          } catch {
            return undefined
          }
        },
      })

      const openWindowFallback = (state) => {
        const hit = { sessionId: state.sessionId, absolutePath: state.absolutePath }
        closeViewer()
        openInDsWindow(ctx, hit).catch(() => showToast(t('error')))
      }

      const headerFor = (state) =>
        React.createElement(
          'div',
          { className: 'dsh-tdfi-head' },
          React.createElement(FileTypeIcon, { path: state.absolutePath, size: 20 }),
          React.createElement(PathLabel, { path: state.absolutePath, className: 'dsh-tdfi-path' }),
          typeof state.line === 'number' ? React.createElement('span', { className: 'dsh-tdfi-meta' }, t('line', { line: state.line })) : null,
          typeof state.bytes === 'number' && state.bytes > 0 ? React.createElement('span', { className: 'dsh-tdfi-meta' }, fileSizeText(state.bytes)) : null,
        )

      const bodyFor = (state) => {
        if (state.phase === 'loading') {
          return React.createElement(
            'div',
            { className: 'dsh-tdfi-loading' },
            React.createElement(StateDot, { state: 'ongoing' }),
            React.createElement('span', null, t('loading')),
          )
        }
        if (state.phase === 'error') {
          return React.createElement('div', { className: 'dsh-tdfi-error' }, state.error ?? t('error'))
        }
        if (state.kind === 'markdown') {
          return React.createElement(
            React.Fragment,
            null,
            React.createElement(
              'div',
              { className: 'dsh-tdfi-md' },
              React.createElement(
                MarkdownDelegateProvider,
                { openExternalLink, openFile: (path, options) => openLinkedFile(state, path, options) },
                React.createElement(MarkdownText, { text: state.text ?? '', labels: markdownLabels(), pathImages: pathImagesFor(state) }),
              ),
            ),
            state.truncated === true ? React.createElement('div', { className: 'dsh-tdfi-note' }, t('truncated')) : null,
          )
        }
        if (state.kind === 'code') {
          return React.createElement(
            React.Fragment,
            null,
            React.createElement(
              'div',
              { className: 'dsh-tdfi-code' },
              React.createElement(CodeBlock, {
                code: state.text ?? '',
                lang: state.language,
                lineNumbers: true,
                copyLabel: t('copy'),
                copiedLabel: t('copied'),
                toolbarLabels: codeToolbarLabels(),
              }),
            ),
            state.truncated === true ? React.createElement('div', { className: 'dsh-tdfi-note' }, t('truncated')) : null,
          )
        }
        if (state.kind === 'image') {
          return React.createElement('div', { className: 'dsh-tdfi-image' }, React.createElement('img', { src: state.url, alt: state.fileName }))
        }
        if (state.kind === 'pdf') {
          return React.createElement('iframe', { className: 'dsh-tdfi-frame', src: state.url, title: state.fileName })
        }
        if (state.kind === 'html') {
          return React.createElement('iframe', { className: 'dsh-tdfi-frame', src: state.url, title: state.fileName, sandbox: '' })
        }
        const reasonKey = state.reason === 'office' ? 'unsupportedOffice' : state.reason === 'tooLarge' ? 'unsupportedTooLarge' : state.reason === 'readFailed' ? 'unsupportedReadFailed' : 'unsupportedBinary'
        return React.createElement(
          'div',
          { className: 'dsh-tdfi-unsupported' },
          React.createElement(FileTypeIcon, { path: state.absolutePath, size: 44 }),
          React.createElement('div', null, t(reasonKey)),
        )
      }

      const footerFor = (state) => {
        const canFallback = state.phase === 'error' || (state.phase === 'ready' && (state.kind === 'unsupported' || state.origin === 'office'))
        return React.createElement(
          React.Fragment,
          null,
          canFallback ? React.createElement(Button, { variant: 'outline', onClick: () => openWindowFallback(state) }, t('openInWindow')) : null,
          React.createElement(Button, { onClick: () => closeViewer() }, t('close')),
        )
      }

      const scrollViewerToLine = (line) => {
        if (typeof line !== 'number' || line < 1) return false
        let content = null
        try {
          content = document.querySelector('.dsh-tdfi-content')
        } catch {
          return false
        }
        if (content === null) return false
        const nodes = content.querySelectorAll('[data-code-block-content] .line')
        if (nodes.length === 0) return false
        const target = nodes[Math.min(nodes.length, line) - 1]
        if (target === undefined) return false
        try {
          target.scrollIntoView({ block: 'center' })
        } catch {
          try {
            target.scrollIntoView()
          } catch {
            return false
          }
        }
        return true
      }

      const Viewer = () => {
        const state = React.useSyncExternalStore(subscribeViewer, getViewer)
        const targetLine = state !== null && typeof state === 'object' ? state.line : undefined
        const text = state !== null && typeof state === 'object' ? state.text : undefined
        const phase = state !== null && typeof state === 'object' ? state.phase : undefined
        // The code viewer highlights asynchronously (its grammar arrives after
        // the first paint), so retry the jump while that DOM settles.
        React.useEffect(() => {
          if (typeof targetLine !== 'number') return undefined
          const timers = [0, 160, 480, 1000, 1800].map((delay) => setTimeout(() => { scrollViewerToLine(targetLine) }, delay))
          return () => {
            for (const id of timers) clearTimeout(id)
          }
        }, [targetLine, text, phase])
        if (state === null) return null
        return React.createElement(
          Modal,
          {
            open: true,
            onClose: () => closeViewer(),
            title: state.fileName,
            closeLabel: t('close'),
            className: 'dsh-tdfi-dialog',
            contentClassName: 'dsh-tdfi-content',
            footer: footerFor(state),
          },
          headerFor(state),
          bodyFor(state),
        )
      }

      const ToastHost = () => {
        const current = React.useSyncExternalStore(subscribeToast, readToast)
        if (current === null) return null
        return React.createElement(Toast, {
          key: current.seq,
          text: current.text,
          holdMs: TOAST_MS,
          onDone: () => {
            if (toastState.current === current) {
              toastState.current = null
              emitToast()
            }
          },
        })
      }

      const Overlay = () => React.createElement(React.Fragment, null, React.createElement(Viewer), React.createElement(ToastHost))

      ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: NS, order: 60, locale: NS }, Overlay))

      const openCanvasTarget = async (target) => {
        try {
          const hit = await resolveTarget(ctx, target, [])
          if (hit === null) {
            showToast(t('unresolved', { path: target.path }))
            return false
          }
          await openViewerFile(ctx, hit, target.line)
          return true
        } catch (error) {
          console.warn('[dsh-thoughtdag-file-open] open failed:', error)
          showToast(t('error'))
          return false
        }
      }

      ctx.effect(() => installFrameBridge(ctx, openCanvasTarget), 'dsh-thoughtdag-file-open: canvas links')

      // A small manual handle for verification from the page's devtools, e.g.
      // `await __dshThoughtdagFileOpen.open('docs/product/status.md')`.
      try {
        window.__dshThoughtdagFileOpen = {
          version: VERSION,
          open(href) {
            const classified = classifyHref(String(href))
            return Promise.resolve(classified !== null ? openCanvasTarget(classified) : false)
          },
          state: () => viewer.state,
          close: () => closeViewer(),
        }
        ctx.effect(
          () => () => {
            closeViewer()
            try {
              delete window.__dshThoughtdagFileOpen
            } catch {
              // already gone
            }
          },
          'dsh-thoughtdag-file-open: debug handle',
        )
      } catch (error) {
        console.warn('[dsh-thoughtdag-file-open] debug handle unavailable:', error)
      }
    }

    return module.exports
  },
})
