// @local/thoughtdag-file-open — chunk: pure path / link / file-kind helpers.
//
// This chunk has no React and no Host access: it is the vocabulary the entry
// module and the other chunks share. Loading it as a package-local chunk keeps
// the entry bundle small and keeps the path rules in one testable file.
window.__ModuleLoader__.load({
  id: '@local/thoughtdag-file-open',
  chunk: 'client.util.js',
  factory: () => {
    const module = { exports: {} }

    const VERSION = '3.0.0'
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
    const BARE_FILE_NAMES = new Set([
      'dockerfile',
      'containerfile',
      'makefile',
      'rakefile',
      'gemfile',
      'procfile',
      'brewfile',
      'license',
      'licence',
      'notice',
      'copying',
      'readme',
      'changelog',
      'authors',
      'contributing',
      'go.mod',
      'go.sum',
      'cargo.lock',
    ])
    const DIR_KEY = /(?:agentcwd|cwd|workingdir|workspacedir|basedir|rootdir|directory|folder|dir)$/i
    // Keep the code viewer responsive: Shiki highlights the whole buffer.
    const MAX_CODE_CHARS = 150000
    const MAX_MARKDOWN_CHARS = 400000

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
      const looksLikeFile =
        (extension !== '' && /^[a-z][a-z0-9]{0,9}$/.test(extension)) ||
        BARE_FILE_NAMES.has(basenameOf(base).toLowerCase())
      if (!looksLikeFile) return { path: value, line: undefined }
      return { path: base, line: Number(match[2]) }
    }

    /** Classify a path by the view this viewer can draw for it. */
    function fileInfo(path) {
      const extension = extensionOf(path)
      if (MARKDOWN_EXTENSIONS.has(extension)) return { kind: 'markdown' }
      if (IMAGE_MIME[extension] !== undefined) return { kind: 'image', mime: IMAGE_MIME[extension] }
      if (PDF_EXTENSIONS.has(extension)) return { kind: 'pdf' }
      if (HTML_EXTENSIONS.has(extension)) return { kind: 'html' }
      if (OFFICE_EXTENSIONS.has(extension)) return { kind: 'office' }
      return { kind: 'auto' }
    }

    /** Only text views can be edited in place; binary previews stay read-only. */
    function isEditableKind(kind) {
      return kind === 'markdown' || kind === 'code'
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
      const looksLikeFile =
        (extension !== '' && /^[a-z][a-z0-9]{0,9}$/.test(extension)) ||
        BARE_FILE_NAMES.has(basenameOf(clean).toLowerCase()) ||
        isAbsolutePath(clean)
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

    module.exports = {
      VERSION,
      MAX_CODE_CHARS,
      MAX_MARKDOWN_CHARS,
      MARKDOWN_EXTENSIONS,
      IMAGE_MIME,
      BARE_FILE_NAMES,
      DIR_KEY,
      encodeSegment,
      sessionFileAddress,
      isAbsolutePath,
      normalizeTargetPath,
      joinPath,
      basenameOf,
      dirnameOf,
      extensionOf,
      decodeLoose,
      lineFromFragment,
      splitLineSuffix,
      fileInfo,
      isEditableKind,
      parseFileURL,
      classifyHref,
      withTimeout,
    }
    return module.exports
  },
})
