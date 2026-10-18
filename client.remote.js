// dsh-thoughtdag-file-open — chunk: Host file access.
//
// Everything here talks to the Host half or to the DSH Remote faces the entry
// module injected: workspace-file reads, the browser bridge the ThoughtDAG host
// half serves, the canvas's persisted project directories, and the save route
// the Host half registers on the authenticated `/api` fence.
window.__ModuleLoader__.load({
  id: 'dsh-thoughtdag-file-open',
  chunk: 'client.remote.js',
  factory: () => {
    const module = { exports: {} }

    const SAVE_PATH = 'api/thoughtdag-file-open.save'
    const CAPABILITIES_PATH = 'api/thoughtdag-file-open'
    const RESOLVE_TIMEOUT_MS = 4000
    const MAX_STAT_SESSIONS = 24
    const MAX_BASES = 32
    const MAX_TEXT_PAGES = 6
    const PERSISTED_CACHE_MS = 15000

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
              (result) =>
                resolve(
                  result !== null && typeof result === 'object'
                    ? result
                    : { ok: false, error: { code: 'client/bad-result' } },
                ),
              (error) =>
                resolve({
                  ok: false,
                  error: { code: 'client/call-failed', message: error instanceof Error ? error.message : String(error) },
                }),
            )
          } else {
            resolve(
              pending !== null && typeof pending === 'object'
                ? pending
                : { ok: false, error: { code: 'client/bad-result' } },
            )
          }
        } catch (error) {
          resolve({
            ok: false,
            error: { code: 'client/call-failed', message: error instanceof Error ? error.message : String(error) },
          })
        }
      })
    }

    /** Absolute URL of a document-relative API route (the shell may live under a mount). */
    function apiUrl(path) {
      try {
        return new URL(path, document.baseURI).href
      } catch {
        return path
      }
    }

    /**
     * Create the Host-facing half of the viewer.
     *
     * @param options.ctx - Client context with the injected Remote namespaces.
     * @param options.util - the pure helper chunk.
     */
    function createRemote({ ctx, util }) {
      const persistedCache = { at: 0, value: null }

      async function stat(sessionId, path) {
        const result = await callRemote(ctx.remote.workspaceFiles, 'stat', [sessionId, path])
        return result.ok === true &&
          result.value !== null &&
          typeof result.value === 'object' &&
          typeof result.value.absolutePath === 'string'
          ? result.value
          : null
      }

      async function readText(sessionId, path, signal, maxChars) {
        let offset = 1
        let text = ''
        let version
        for (let page = 0; page < MAX_TEXT_PAGES; page += 1) {
          const result = await callRemote(ctx.remote.workspaceFiles, 'read', [sessionId, path, { offset }, signal])
          if (result.ok !== true) return { ok: false, code: result.error?.code ?? 'workspace-file/read-failed' }
          const value = result.value ?? {}
          if (typeof value.version === 'string') version = value.version
          if (page > 0 && typeof value.text === 'string' && value.text !== '') text += '\n'
          if (typeof value.text === 'string') text += value.text
          if (value.eof === true) return { ok: true, text, version, truncated: false }
          const lines = typeof value.lines === 'number' ? value.lines : 0
          if (lines === 0 || text.length >= maxChars) return { ok: true, text, version, truncated: true }
          offset += lines
        }
        return { ok: true, text, version, truncated: true }
      }

      async function readBytes(sessionId, path, signal) {
        const result = await callRemote(ctx.remote.workspaceFiles, 'readBytes', [sessionId, path, {}, signal])
        if (result.ok !== true) return { ok: false, code: result.error?.code ?? 'workspace-file/read-failed' }
        return { ok: true, data: result.value?.data, bytes: result.value?.bytes, version: result.value?.version }
      }

      async function officeToPdf(sessionId, path, signal) {
        if (ctx.remote?.officeToPdf === undefined) return { ok: false, code: 'client/no-office' }
        const result = await callRemote(ctx.remote.officeToPdf, 'render', [sessionId, path, 'foreground', signal])
        if (result.ok !== true) return { ok: false, code: result.error?.code ?? 'office/render-failed' }
        return { ok: true, data: result.value?.data, bytes: result.value?.bytes }
      }

      /**
       * Probe the Host half once; the editor stays hidden when the Host route
       * is unavailable (for example an older bundle generation).
       */
      async function capabilities(signal) {
        try {
          const response = await fetch(apiUrl(CAPABILITIES_PATH), {
            method: 'GET',
            credentials: 'same-origin',
            headers: { accept: 'application/json' },
            signal,
          })
          if (!response.ok) return { ok: false, editing: false }
          const body = await response.json()
          return {
            ok: body?.ok === true,
            editing: body?.editing === true,
            version: typeof body?.version === 'string' ? body.version : undefined,
            maxContentBytes: typeof body?.maxContentBytes === 'number' ? body.maxContentBytes : undefined,
          }
        } catch {
          return { ok: false, editing: false }
        }
      }

      /**
       * Write one full document through the Host half.
       *
       * @param path - absolute path of the file the viewer showed.
       * @param content - the complete new text.
       * @param options - expected version (stale guard), force flag, session id.
       * @returns `{ ok, version, bytes, status, code, message }`.
       */
      async function saveFile(path, content, options, signal) {
        const payload = { path, content }
        if (typeof options?.expectedVersion === 'string' && options.expectedVersion !== '') {
          payload.expectedVersion = options.expectedVersion
        }
        if (options?.force === true) payload.force = true
        if (typeof options?.sessionId === 'string' && options.sessionId !== '') payload.sessionId = options.sessionId
        try {
          const response = await fetch(apiUrl(SAVE_PATH), {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify(payload),
            signal,
          })
          let body = null
          try {
            body = await response.json()
          } catch {
            body = null
          }
          const ok = response.ok && body?.ok === true
          return {
            ok,
            status: response.status,
            version: ok && typeof body?.version === 'string' ? body.version : undefined,
            bytes: ok && typeof body?.bytes === 'number' ? body.bytes : undefined,
            code: ok ? undefined : body?.code ?? `file-open/http-${String(response.status)}`,
            message: ok ? undefined : body?.message ?? `save failed with ${String(response.status)}`,
          }
        } catch (error) {
          return {
            ok: false,
            status: 0,
            code: 'file-open/network',
            message: error instanceof Error ? error.message : String(error),
          }
        }
      }

      // ── sources of a working directory ─────────────────────────────────────
      function sessionSnapshot() {
        let snapshot
        try {
          snapshot = ctx.sessions.list.getSnapshot()
        } catch {
          snapshot = null
        }
        const byId =
          snapshot !== null && typeof snapshot === 'object' && typeof snapshot.byId === 'object' && snapshot.byId !== null
            ? snapshot.byId
            : {}
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

      function currentSessionId() {
        try {
          const id = ctx.sessions.list.getSnapshot().current
          return typeof id === 'string' ? id : undefined
        } catch {
          return undefined
        }
      }

      // The ThoughtDAG host half serves the canvas SPA and the session bridge
      // under the mount prefix; read it from the iframe the host half created.
      function thoughtdagMount() {
        try {
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
        } catch {
          // no canvas in this page
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

      // The canvas keeps its project (and that project's working directory) in
      // the embedded SPA's persisted store — idb-keyval's `keyval-store`/`keyval`.
      // Returns the active project's own directory first, then every other
      // directory-looking value. Read without ever creating the database:
      // `indexedDB.databases()` proves it exists before the versioned open.
      function collectPersistedDirs(values) {
        const preferred = []
        const dirs = new Set()
        let budget = 20000
        const takeDir = (candidate) => {
          if (typeof candidate !== 'string' || /[\u0000-\u001f]/.test(candidate) || candidate.length >= 1024) return undefined
          const normalized = util.normalizeTargetPath(candidate).replace(/\/+$/, '')
          if (/^[A-Za-z]:$/.test(normalized)) return normalized
          return util.isAbsolutePath(normalized) && normalized !== '' ? normalized : undefined
        }
        const visit = (value, key, depth) => {
          if (budget <= 0 || depth > 8 || value === null || value === undefined) return
          budget -= 1
          if (typeof value === 'string') {
            if (key !== null && key !== undefined && util.DIR_KEY.test(key) && dirs.size < MAX_BASES) {
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
            const active = value.projects.find(
              (project) => project !== null && typeof project === 'object' && project.id === value.activeId,
            )
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
          if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') {
            return { preferred: [], dirs: [] }
          }
          const databases = await indexedDB.databases()
          const info = Array.isArray(databases) ? databases.find((entry) => entry?.name === 'keyval-store') : undefined
          if (info === undefined) return { preferred: [], dirs: [] }
          const db = await new Promise((resolve, reject) => {
            const request =
              typeof info.version === 'number'
                ? indexedDB.open('keyval-store', info.version)
                : indexedDB.open('keyval-store')
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
        if (persistedCache.value !== null && Date.now() - persistedCache.at < PERSISTED_CACHE_MS) {
          return persistedCache.value
        }
        const value = await readPersistedDirs()
        if (value.preferred.length > 0 || value.dirs.length > 0) {
          persistedCache.value = value
          persistedCache.at = Date.now()
        }
        return value
      }

      /**
       * Resolve a clicked/linked href to `{ sessionId, absolutePath }`, or null.
       * Relative targets try, in order: the extra bases (the previewed
       * document's directory), the canvas project directories, the sessions'
       * working directories, then other persisted directory values.
       */
      async function resolveTarget(target, extraBases) {
        const snapshot = sessionSnapshot()
        const authorizers = []
        if (snapshot.currentId !== undefined) authorizers.push(snapshot.currentId)
        for (const session of snapshot.sessions) if (!authorizers.includes(session.id)) authorizers.push(session.id)

        const disk = await util.withTimeout(diskSessions(), RESOLVE_TIMEOUT_MS, [])
        for (const row of disk) {
          if (typeof row?.id === 'string' && row.id !== '' && !authorizers.includes(row.id)) authorizers.push(row.id)
        }
        const authorizer = authorizers[0]
        if (authorizer === undefined) return null

        const wanted = util.normalizeTargetPath(target.path)
        if (util.isAbsolutePath(wanted)) {
          const hit = await stat(authorizer, wanted)
          return hit === null
            ? null
            : { sessionId: authorizer, absolutePath: typeof hit.absolutePath === 'string' ? hit.absolutePath : wanted }
        }

        const persisted = await util.withTimeout(canvasProjectDirs(), 1200, { preferred: [], dirs: [] })
        const bases = []
        const seen = new Set()
        const push = (candidate) => {
          if (typeof candidate !== 'string' || candidate === '') return
          const normalized = util.normalizeTargetPath(candidate).replace(/\/+$/, '')
          // Keep a bare drive root (`C:`): joining it with `joinPath` restores it.
          const usable = /^[A-Za-z]:$/.test(normalized)
            ? normalized
            : util.isAbsolutePath(normalized)
              ? normalized
              : ''
          if (usable === '' || seen.has(usable)) return
          seen.add(usable)
          bases.push(usable)
        }
        for (const dir of extraBases) push(dir)
        for (const dir of persisted.preferred) push(dir)
        for (const session of snapshot.sessions) push(session.cwd)
        for (const row of disk) push(row?.cwd)
        for (const dir of persisted.dirs) push(dir)

        const attempts = bases.slice(0, MAX_BASES).map(async (base) => {
          const absolutePath = util.joinPath(base, wanted)
          const hit = await stat(authorizer, absolutePath)
          return hit === null
            ? null
            : { sessionId: authorizer, absolutePath: typeof hit.absolutePath === 'string' ? hit.absolutePath : absolutePath }
        })
        const settled = await util.withTimeout(Promise.all(attempts), RESOLVE_TIMEOUT_MS, [])
        return Array.isArray(settled) ? (settled.find((hit) => hit !== null && hit !== undefined) ?? null) : null
      }

      return {
        callRemote,
        stat,
        readText,
        readBytes,
        officeToPdf,
        capabilities,
        saveFile,
        sessionSnapshot,
        currentSessionId,
        thoughtdagMount,
        diskSessions,
        resolveTarget,
      }
    }

    module.exports = { createRemote, SAVE_PATH, CAPABILITIES_PATH }
    return module.exports
  },
})
