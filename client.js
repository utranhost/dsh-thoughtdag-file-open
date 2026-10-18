// @local/thoughtdag-file-open — Client entry.
//
// ThoughtDAG's canvas renders Markdown links as ordinary anchors inside its
// same-origin iframe: a relative href such as `docs/product/status.md` resolves
// against `/thoughtdag/` and the canvas navigates to a URL the SPA cannot
// render. This module keeps the click where it is and opens the file in an
// in-page, multi-tab dialog over the canvas.
//
// The dialog has two modes per tab: a read-only preview drawn with the
// Harness's own primitives (the same Markdown/code renderers the chat uses),
// and an in-place editor. Editing is never the default: a tab opens in preview
// and an explicit Edit button switches to the editor; Save writes through the
// Host half's authenticated route with the file version the viewer read, so a
// file changed by someone else raises a conflict banner instead of being
// silently clobbered.
//
// The implementation is split into package-local dynamic chunks loaded with
// `require.async("./client.<name>.js")`:
//
//   client.util.js     pure path / href / file-kind helpers
//   client.remote.js   workspace reads, canvas-dir resolution, save route
//   client.styles.js   the token-only stylesheet
//   client.tabs.js     tab strip and unsaved-changes confirmation card
//   client.preview.js  read-only Markdown/code/image/PDF/HTML/Office bodies
//   client.editor.js   the monospace text editor with a line gutter
//
// This entry owns the tab state, the canvas click bridge, the dialog chrome,
// the edit/save/conflict flow, and the locale dictionaries.
window.__ModuleLoader__.load({
  id: '@local/thoughtdag-file-open',
  factory(require) {
    const React = require('react')
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    const module = { exports: {} }

    const NS = '@local/thoughtdag-file-open'
    const TOAST_MS = 6000
    const OPEN_TIMEOUT_MS = 3000
    // The code view highlights asynchronously, so the jump retries as DOM settles.
    const LINE_SCROLL_DELAYS = [0, 160, 480, 1000, 1800]

    const {
      Modal,
      Button,
      PathLabel,
      FileTypeIcon,
      StateDot,
      Toast,
      IconCloseOutlineRegular,
      IconEditOutlineRegular,
      IconRightUpOutlineRegular,
      IconFullscreenOutlineRegular,
      IconCompactOutlineRegular,
      languageForPath,
      fileSizeText,
    } = primitives

    // ── chunks ──────────────────────────────────────────────────────────────
    let chunks = null
    let chunksPromise = null

    function ensureChunks() {
      if (chunks !== null) return Promise.resolve(chunks)
      if (chunksPromise !== null) return chunksPromise
      chunksPromise = Promise.all([
        require.async('./client.util.js'),
        require.async('./client.remote.js'),
        require.async('./client.styles.js'),
        require.async('./client.tabs.js'),
        require.async('./client.preview.js'),
        require.async('./client.editor.js'),
      ])
        .then(([util, remote, styles, tabs, preview, editor]) => {
          chunks = { util, remote, styles, tabs, preview, editor }
          return chunks
        })
        .catch((error) => {
          chunksPromise = null
          throw error
        })
      return chunksPromise
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
          // ignore one broken listener
        }
      }
    }

    // The viewer renders Markdown, code highlighting and the dialog chrome with
    // the same platform primitives the chat uses (the v2 dependency this plugin
    // shipped with). A renamed primitive would throw while rendering the overlay
    // slot, so fail once, loudly, instead of blanking the slot.
    const REQUIRED_PRIMITIVES = [
      'Modal',
      'Button',
      'PathLabel',
      'FileTypeIcon',
      'StateDot',
      'Toast',
      'IconCloseOutlineRegular',
      'IconEditOutlineRegular',
      'IconRightUpOutlineRegular',
      'IconFullscreenOutlineRegular',
      'IconCompactOutlineRegular',
      'languageForPath',
      'fileSizeText',
    ]

    // ── plugin body ────────────────────────────────────────────────────────
    module.exports.inject = ['sessions', 'layout', 'remote', 'remote.workspaceFiles', 'sidebarRight', 'locale', 'slots']
    module.exports.apply = (ctx) => {
      const missing = REQUIRED_PRIMITIVES.filter((name) => primitives?.[name] === undefined)
      if (missing.length > 0) {
        console.warn('[dsh-thoughtdag-file-open] UI primitives are unavailable:', missing.join(', '))
        return
      }
      ctx.effect(
        () =>
          ctx.locale.register(NS, {
            zh: {
              title: '文件预览',
              loading: '正在加载文件…',
              close: '关闭',
              copy: '复制',
              copied: '已复制',
              code: '代码',
              wrap: '自动换行',
              unwrap: '不换行',
              footnotes: '脚注',
              truncated: '文件较大，这里只显示前面的内容。',
              truncatedEdit: '这个文件只读取了前面一部分，不能直接编辑；请在文件窗口中打开后编辑。',
              unresolved: '找不到这个文件：{path}\n请确认画布的工作目录后重试。',
              unsupportedBinary: '这个文件是二进制或暂不支持的格式，无法在这里预览。',
              unsupportedOffice: '这个 Office 文件无法转换预览，可以在 DSH 的文件窗口中打开。',
              unsupportedTooLarge: '文件太大，无法在这里预览。',
              unsupportedReadFailed: '读取这个文件失败。',
              error: '打开这个文件时出错。',
              line: '第 {line} 行',
              openInWindow: '在文件窗口打开',
              maximize: '最大化',
              restore: '还原',
              maximizeHint: 'Ctrl/⌘ + Shift + M',
              edit: '编辑',
              preview: '预览',
              save: '保存',
              saving: '正在保存…',
              saved: '已保存',
              unsaved: '未保存的修改',
              previewMode: '预览模式',
              cancel: '取消',
              closeTab: '关闭标签页',
              tabsLabel: '已打开的文件',
              unsavedTitle: '有未保存的修改',
              unsavedBody: '“{name}” 有未保存的修改，关闭后会丢失。',
              unsavedBodyMany: '有 {count} 个文件包含未保存的修改，关闭后会丢失。',
              discard: '放弃修改',
              discardEditTitle: '放弃当前修改？',
              discardEditBody: '编辑内容还没有保存，返回预览会丢失这些修改。',
              discardEdit: '放弃修改',
              saveAndClose: '保存并关闭',
              saveFailed: '保存失败：{message}',
              conflict: '文件已在磁盘上被修改，请重新加载或仍然保存。',
              conflictReload: '重新加载',
              conflictForce: '仍然保存',
              editUnavailable: '当前 Host 不支持保存文件，只能预览。',
              editorLabel: '文件内容编辑器',
              editorFallback: 'CodeMirror 没有启动成功，已退回纯文本编辑器（{message}）。',
              hintSave: 'Ctrl/⌘ S 保存',
              hintEdit: 'Ctrl/⌘ E 编辑',
            },
            en: {
              title: 'File preview',
              loading: 'Loading file…',
              close: 'Close',
              copy: 'Copy',
              copied: 'Copied',
              code: 'Code',
              wrap: 'Wrap',
              unwrap: 'No wrap',
              footnotes: 'Footnotes',
              truncated: 'This file is large; only the beginning is shown.',
              truncatedEdit: 'Only the beginning of this large file was read, so it cannot be edited here; open it in the document window instead.',
              unresolved: 'Could not find this file: {path}\nCheck the canvas working directory and try again.',
              unsupportedBinary: 'This file is binary or in a format the in-page viewer does not support.',
              unsupportedOffice: 'This Office document could not be converted for preview; open it in DSH’s document window instead.',
              unsupportedTooLarge: 'This file is too large to preview here.',
              unsupportedReadFailed: 'Reading this file failed.',
              error: 'Opening this file failed.',
              line: 'Line {line}',
              openInWindow: 'Open in document window',
              maximize: 'Maximize',
              restore: 'Restore',
              maximizeHint: 'Ctrl/⌘ + Shift + M',
              edit: 'Edit',
              preview: 'Preview',
              save: 'Save',
              saving: 'Saving…',
              saved: 'Saved',
              unsaved: 'Unsaved changes',
              previewMode: 'Preview mode',
              cancel: 'Cancel',
              closeTab: 'Close tab',
              tabsLabel: 'Open files',
              unsavedTitle: 'Unsaved changes',
              unsavedBody: '“{name}” has unsaved changes that will be lost if it closes.',
              unsavedBodyMany: '{count} files have unsaved changes that will be lost if they close.',
              discard: 'Discard',
              discardEditTitle: 'Discard these changes?',
              discardEditBody: 'The editor content is not saved yet; going back to the preview loses it.',
              discardEdit: 'Discard',
              saveAndClose: 'Save & close',
              saveFailed: 'Saving failed: {message}',
              conflict: 'The file changed on disk. Reload it or save anyway.',
              conflictReload: 'Reload',
              conflictForce: 'Save anyway',
              editUnavailable: 'This Host does not support saving files; preview only.',
              editorLabel: 'File content editor',
              editorFallback: 'CodeMirror did not start; using the plain text editor instead ({message}).',
              hintSave: 'Ctrl/⌘ S to save',
              hintEdit: 'Ctrl/⌘ E to edit',
            },
          }),
        'dsh-thoughtdag-file-open: dictionaries',
      )
      const t = ctx.locale.bind(NS)

      // ── Host-facing API (available once the chunks arrive) ────────────────
      let host = null
      let capabilities = null
      let editingSupported = false
      let uiComponents = null

      async function hostApi() {
        const loaded = await ensureChunks()
        if (host === null) host = { remote: loaded.remote.createRemote({ ctx, util: loaded.util }), util: loaded.util }
        return host
      }

      function ensureCapabilities() {
        if (capabilities !== null) return capabilities
        capabilities = hostApi()
          .then(({ remote }) => remote.capabilities())
          .then((result) => {
            editingSupported = result.editing === true
            emitView()
            return result
          })
          .catch(() => {
            editingSupported = false
            emitView()
            return { ok: false, editing: false }
          })
        return capabilities
      }

      /** A tab is editable only when it is complete text: a truncated read must never be saved back. */
      function canEditTab(tab) {
        return (
          tab !== null &&
          tab.phase === 'ready' &&
          tab.truncated !== true &&
          chunks !== null &&
          chunks.util.isEditableKind(tab.kind)
        )
      }

      function components() {
        if (uiComponents !== null) return uiComponents
        const tabs = chunks.tabs.createTabs({ primitives })
        const preview = chunks.preview.createPreview({ util: chunks.util, t })
        const editor = chunks.editor.createEditor({ t })
        uiComponents = {
          TabStrip: tabs.TabStrip,
          ConfirmOverlay: tabs.ConfirmOverlay,
          PreviewBody: preview.PreviewBody,
          Editor: editor.Editor,
          scrollTexture: preview.scrollCodeToLine,
        }
        return uiComponents
      }

      // ── view state ────────────────────────────────────────────────────────
      // One immutable snapshot per change, so React's external-store comparison
      // re-renders exactly once per action.
      let view = { tabs: [], activeId: null, confirm: null, maximized: false }
      const viewListeners = new Set()
      const controllers = new Map()
      // The mounted editor's imperative face (undefined when no editor is up).
      let editorApi = null
      // Last reported editor mode, so diagnostics can say CodeMirror vs fallback.
      let editorInfo = { mode: 'idle', detail: null }

      function editorReady(api) {
        editorApi = api === undefined ? null : api
      }

      /**
       * Push the editor's live document into the tab's draft state.
       *
       * Call this before any action that reads `draft` or decides on dirtiness
       * from a debounced update: the editor syncs drafts lazily, so a save, a
       * tab switch or a close must not race a pending debounce.
       */
      function flushEditor() {
        try {
          editorApi?.flush?.()
        } catch {
          // an already-destroyed editor has nothing to flush
        }
      }

      function getView() {
        return view
      }

      function subscribeView(listener) {
        viewListeners.add(listener)
        return () => {
          viewListeners.delete(listener)
        }
      }

      function emitView() {
        for (const listener of [...viewListeners]) {
          try {
            listener()
          } catch {
            // a broken listener must not break the others
          }
        }
      }

      function setView(patch) {
        view = { ...view, ...patch }
        emitView()
      }

      function tabDirty(tab) {
        if (tab.mode !== 'edit') return false
        // The editor reports the first keystroke before its debounced draft
        // lands, so a pending edit counts as dirty immediately.
        if (tab.editorDirty === true) return true
        return typeof tab.draft === 'string' && typeof tab.savedText === 'string' && tab.draft !== tab.savedText
      }

      function patchTab(id, patch) {
        const index = view.tabs.findIndex((tab) => tab.id === id)
        if (index === -1) return null
        const next = { ...view.tabs[index], ...patch }
        next.dirty = tabDirty(next)
        const tabs = view.tabs.slice()
        tabs[index] = next
        setView({ tabs })
        return next
      }

      function findTab(id) {
        return view.tabs.find((tab) => tab.id === id) ?? null
      }

      function activeTab() {
        return findTab(view.activeId)
      }

      function isCurrent(id) {
        return findTab(id) !== null
      }

      /** Fill the viewport (or return to the roomy centered card). */
      function toggleMaximized() {
        setView({ maximized: view.maximized !== true })
      }

      function showToast(text) {
        if (typeof text !== 'string' || text === '') return
        toastState.seq += 1
        toastState.current = { text, seq: toastState.seq }
        emitToast()
      }

      // ── reading one file into its tab ─────────────────────────────────────
      async function loadTab(id) {
        const tab = findTab(id)
        if (tab === null) return
        const { remote, util } = await hostApi()
        if (!isCurrent(id)) return
        const controller = new AbortController()
        controllers.get(id)?.abort()
        controllers.set(id, controller)
        const info = util.fileInfo(tab.absolutePath)
        const kind = info.kind === 'auto' ? 'code' : info.kind
        patchTab(id, {
          kind,
          origin: info.kind,
          language: kind === 'code' ? languageForPath(tab.absolutePath) : undefined,
          phase: 'loading',
          error: undefined,
          reason: undefined,
          conflict: false,
        })
        try {
          if (info.kind === 'image' || info.kind === 'pdf' || info.kind === 'html') {
            const result = await remote.readBytes(tab.sessionId, tab.absolutePath, controller.signal)
            if (controllers.get(id) !== controller) return
            if (result.ok !== true) {
              patchTab(id, { phase: 'ready', kind: 'unsupported', reason: 'readFailed' })
              return
            }
            const mime =
              info.kind === 'image' ? info.mime : info.kind === 'pdf' ? 'application/pdf' : 'text/html'
            const url = URL.createObjectURL(new Blob([result.data], { type: mime }))
            patchTab(id, { phase: 'ready', kind: info.kind, url, bytes: result.bytes, version: result.version })
            return
          }
          if (info.kind === 'office') {
            const result = await remote.officeToPdf(tab.sessionId, tab.absolutePath, controller.signal)
            if (controllers.get(id) !== controller) return
            if (result.ok !== true) {
              patchTab(id, { phase: 'ready', kind: 'unsupported', reason: 'office' })
              return
            }
            const url = URL.createObjectURL(new Blob([result.data], { type: 'application/pdf' }))
            patchTab(id, { phase: 'ready', kind: 'pdf', origin: 'office', url, bytes: result.bytes })
            return
          }
          const maxChars = info.kind === 'markdown' ? util.MAX_MARKDOWN_CHARS : util.MAX_CODE_CHARS
          const read = await remote.readText(tab.sessionId, tab.absolutePath, controller.signal, maxChars)
          if (controllers.get(id) !== controller) return
          if (read.ok !== true) {
            patchTab(id, {
              phase: 'ready',
              kind: 'unsupported',
              reason:
                read.code === 'workspace-file/too-large'
                  ? 'tooLarge'
                  : read.code === 'workspace-file/not-text'
                    ? 'binary'
                    : 'readFailed',
            })
            return
          }
          const next = patchTab(id, {
            phase: 'ready',
            kind: info.kind === 'markdown' ? 'markdown' : 'code',
            text: read.text,
            savedText: read.text,
            draft: read.text,
            version: read.version,
            truncated: read.truncated === true,
          })
          // A tab reloaded while editing keeps its draft in sync with the file.
          if (next !== null && next.mode === 'edit') patchTab(id, { draft: read.text })
        } catch (error) {
          if (controllers.get(id) !== controller) return
          patchTab(id, { phase: 'error', error: error instanceof Error ? error.message : String(error) })
        }
      }

      async function reloadTab(id) {
        const tab = findTab(id)
        if (tab === null) return
        if (tab.url !== undefined) {
          try {
            URL.revokeObjectURL(tab.url)
          } catch {
            // already revoked
          }
        }
        controllers.get(id)?.abort()
        controllers.delete(id)
        patchTab(id, { url: undefined, conflict: false })
        await loadTab(id)
      }

      // ── opening a tab ─────────────────────────────────────────────────────
      async function openHit(hit, line) {
        const { util } = await hostApi()
        const targetLine =
          typeof line === 'number' && Number.isFinite(line) && line > 0 ? Math.floor(line) : undefined
        const existing = findTab(hit.absolutePath)
        if (existing !== null) {
          patchTab(existing.id, { line: targetLine ?? existing.line })
          setView({ activeId: existing.id, confirm: null })
          if (existing.phase === 'error') reloadTab(existing.id)
          return existing.id
        }
        const info = util.fileInfo(hit.absolutePath)
        const kind = info.kind === 'auto' ? 'code' : info.kind
        const tab = {
          id: hit.absolutePath,
          sessionId: hit.sessionId,
          absolutePath: hit.absolutePath,
          fileName: util.basenameOf(hit.absolutePath),
          kind,
          origin: info.kind,
          language: kind === 'code' ? languageForPath(hit.absolutePath) : undefined,
          phase: 'loading',
          line: targetLine,
          mode: 'preview',
          text: undefined,
          draft: undefined,
          savedText: undefined,
          version: undefined,
          truncated: false,
          bytes: undefined,
          url: undefined,
          reason: undefined,
          error: undefined,
          conflict: false,
          saving: false,
          dirty: false,
        }
        setView({ tabs: [...view.tabs, tab], activeId: tab.id, confirm: null })
        ensureCapabilities()
        // Reading a text preview is the moment before a likely Edit click, so
        // warm the 696 KiB vendored editor in the background now.
        if (kind === 'markdown' || kind === 'code') {
          try {
            chunks.editor.prefetchCodeMirror?.()
          } catch {
            // the fallback editor still works
          }
        }
        loadTab(tab.id)
        return tab.id
      }

      function activateTab(id) {
        if (!isCurrent(id)) return
        if (id !== view.activeId) flushEditor()
        setView({ activeId: id, confirm: null })
      }

      // ── closing tabs and the dialog ───────────────────────────────────────
      function closeTabNow(id) {
        controllers.get(id)?.abort()
        controllers.delete(id)
        const tab = findTab(id)
        if (tab !== null && tab.url !== undefined) {
          try {
            URL.revokeObjectURL(tab.url)
          } catch {
            // already revoked
          }
        }
        const index = view.tabs.findIndex((entry) => entry.id === id)
        const tabs = view.tabs.filter((entry) => entry.id !== id)
        let activeId = view.activeId
        if (activeId === id) {
          const next = tabs[Math.min(index < 0 ? 0 : index, tabs.length - 1)]
          activeId = next === undefined ? null : next.id
        }
        setView({ tabs, activeId, confirm: null })
      }

      function requestCloseTab(id) {
        flushEditor()
        const tab = findTab(id)
        if (tab === null) return
        if (tabDirty(tab)) {
          setView({ confirm: { kind: 'closeTab', tabId: id, name: tab.fileName, count: 1 } })
          return
        }
        closeTabNow(id)
      }

      function closeAllNow() {
        for (const tab of view.tabs) {
          controllers.get(tab.id)?.abort()
          if (tab.url !== undefined) {
            try {
              URL.revokeObjectURL(tab.url)
            } catch {
              // already revoked
            }
          }
        }
        controllers.clear()
        setView({ tabs: [], activeId: null, confirm: null, maximized: false })
      }

      function requestCloseDialog() {
        flushEditor()
        const dirty = view.tabs.filter((tab) => tabDirty(tab))
        if (dirty.length === 0) {
          closeAllNow()
          return
        }
        const active = activeTab()
        setView({
          confirm: {
            kind: 'closeDialog',
            tabId: active === null ? dirty[0].id : active.id,
            name: active === null ? dirty[0].fileName : active.fileName,
            count: dirty.length,
          },
        })
      }

      // ── preview / edit mode ───────────────────────────────────────────────
      async function setMode(id, mode) {
        const { util } = await hostApi()
        if (mode !== 'edit') flushEditor()
        const tab = findTab(id)
        if (tab === null || tab.phase !== 'ready') return
        if (mode === 'edit') {
          if (!util.isEditableKind(tab.kind)) return
          if (tab.truncated === true) {
            showToast(t('truncatedEdit'))
            return
          }
          const capability = await ensureCapabilities()
          if (capability.editing !== true) {
            showToast(t('editUnavailable'))
            return
          }
          patchTab(id, {
            mode: 'edit',
            draft: typeof tab.savedText === 'string' ? tab.savedText : '',
            editorDirty: false,
            conflict: false,
          })
          return
        }
        if (tabDirty(tab)) {
          setView({ confirm: { kind: 'cancelEdit', tabId: id, name: tab.fileName, count: 1 } })
          return
        }
        patchTab(id, { mode: 'preview', draft: tab.savedText, editorDirty: false, conflict: false })
      }

      function setDraft(id, draft) {
        const tab = findTab(id)
        if (tab === null || tab.mode !== 'edit') return
        patchTab(id, { draft })
      }

      async function saveTab(id, options) {
        const { remote } = await hostApi()
        // Take the editor's live buffer first: the debounced draft may lag.
        flushEditor()
        const tab = findTab(id)
        if (tab === null || tab.mode !== 'edit' || tab.saving === true || tab.truncated === true) return false
        const draft = typeof tab.draft === 'string' ? tab.draft : ''
        patchTab(id, { saving: true })
        // Once a conflict was surfaced, the next Save is the operator's explicit
        // 'overwrite anyway', exactly like the conflict banner's button.
        const force = options?.force === true || tab.conflict === true
        const result = await remote.saveFile(tab.absolutePath, draft, {
          expectedVersion: force ? undefined : tab.version,
          force,
          sessionId: tab.sessionId,
        })
        if (result.ok !== true) {
          if (result.code === 'FS_STALE_VERSION') {
            patchTab(id, { saving: false, conflict: true })
            return false
          }
          patchTab(id, { saving: false })
          showToast(t('saveFailed', { message: result.message ?? '' }))
          return false
        }
        patchTab(id, {
          saving: false,
          draft,
          savedText: draft,
          text: draft,
          editorDirty: false,
          version: result.version,
          bytes: result.bytes,
          conflict: false,
        })
        return true
      }

      // ── confirmation card actions ─────────────────────────────────────────
      function cancelConfirm() {
        setView({ confirm: null })
      }

      function discardConfirm() {
        const confirm = view.confirm
        if (confirm === null) return
        if (confirm.kind === 'closeTab') closeTabNow(confirm.tabId)
        else if (confirm.kind === 'closeDialog') closeAllNow()
        else if (confirm.kind === 'cancelEdit') {
          const tab = findTab(confirm.tabId)
          if (tab !== null) patchTab(tab.id, { mode: 'preview', draft: tab.savedText, conflict: false })
          setView({ confirm: null })
        }
      }

      async function saveConfirm() {
        const confirm = view.confirm
        if (confirm === null) return
        if (confirm.kind === 'closeTab') {
          if (await saveTab(confirm.tabId)) closeTabNow(confirm.tabId)
          else setView({ confirm: null })
          return
        }
        if (confirm.kind === 'closeDialog') {
          const dirty = view.tabs.filter((tab) => tabDirty(tab))
          for (const tab of dirty) {
            const saved = await saveTab(tab.id)
            if (!saved) {
              setView({ confirm: null })
              return
            }
          }
          closeAllNow()
        }
      }

      // ── linked files inside a preview ─────────────────────────────────────
      async function openLinkedFile(tab, path, options) {
        const { remote, util } = await hostApi()
        const raw = String(path)
        const hashAt = raw.indexOf('#')
        const fragment = hashAt === -1 ? undefined : raw.slice(hashAt + 1)
        const destination = raw.slice(0, hashAt === -1 ? raw.length : hashAt).split('?')[0]
        if (destination === '') return
        const normalized = util.normalizeTargetPath(destination)
        const suffix = util.splitLineSuffix(normalized)
        const line = options?.line ?? util.lineFromFragment(fragment) ?? suffix.line
        const hit = await remote.resolveTarget(
          { path: suffix.path, absolute: util.isAbsolutePath(suffix.path) },
          [util.dirnameOf(tab.absolutePath)],
        )
        if (hit === null) {
          showToast(t('unresolved', { path: suffix.path }))
          return
        }
        await openHit(hit, line)
      }

      // ── the harness's own document window (fallback) ──────────────────────
      function readMounted() {
        try {
          return ctx.sidebarRight?.mounted?.getSnapshot?.()
        } catch {
          return undefined
        }
      }

      function selectSession(sessionId) {
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

      function openDocumentTab(sessionId, address) {
        return new Promise((resolve) => {
          const deadline = Date.now() + OPEN_TIMEOUT_MS
          const attempt = () => {
            if (readMounted() === sessionId) {
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

      async function openInWindow(tab) {
        const { remote, util } = await hostApi()
        let sessionId = remote.currentSessionId()
        if (sessionId === undefined) {
          sessionId = tab.sessionId
          selectSession(sessionId)
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
        const address = util.sessionFileAddress(sessionId, tab.absolutePath)
        if (await openDocumentTab(sessionId, address)) return true
        dismissCanvasOverlay()
        return openDocumentTab(sessionId, address)
      }

      // ── canvas click bridge ───────────────────────────────────────────────
      function handleCanvasClick(event, util, openTarget) {
        if (event.defaultPrevented) return
        if (typeof event.button === 'number' && event.button !== 0) return
        const target = event.target
        const element = target !== null && target !== undefined && target.nodeType === 1 ? target : target?.parentElement
        const anchor =
          element !== null && element !== undefined && typeof element.closest === 'function'
            ? element.closest('a[href]')
            : null
        if (anchor === null || anchor === undefined) return
        const classified = util.classifyHref(anchor.getAttribute('href') ?? '')
        if (classified === null) return
        event.preventDefault()
        event.stopPropagation()
        openTarget(classified)
      }

      function installFrameBridge(util, openTarget) {
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
          entry.onClick = (event) => handleCanvasClick(event, util, openTarget)
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

      async function openCanvasTarget(classified) {
        try {
          const { remote } = await hostApi()
          const hit = await remote.resolveTarget(classified, [])
          if (hit === null) {
            showToast(t('unresolved', { path: classified.path }))
            return false
          }
          await openHit(hit, classified.line)
          return true
        } catch (error) {
          console.warn('[dsh-thoughtdag-file-open] open failed:', error)
          showToast(t('error'))
          return false
        }
      }

      // ── dialog chrome ─────────────────────────────────────────────────────
      function renderActions(tab) {
        if (tab === null) return null
        const nodes = []
        const editable = canEditTab(tab) && editingSupported
        if (editable && tab.mode === 'preview') {
          nodes.push(
            React.createElement(
              Button,
              {
                key: 'edit',
                size: 'sm',
                variant: 'outline',
                icon: React.createElement(IconEditOutlineRegular, { size: 14 }),
                onClick: () => setMode(tab.id, 'edit'),
                title: t('hintEdit'),
              },
              t('edit'),
            ),
          )
        }
        if (tab.mode === 'edit') {
          nodes.push(
            React.createElement(Button, { key: 'cancel', size: 'sm', variant: 'ghost', onClick: () => setMode(tab.id, 'preview'), disabled: tab.saving === true }, t('cancel')),
            React.createElement(
              Button,
              {
                key: 'save',
                size: 'sm',
                variant: 'primary',
                onClick: () => saveTab(tab.id),
                disabled: tab.saving === true || tab.dirty !== true,
                title: t('hintSave'),
              },
              tab.saving === true ? t('saving') : t('save'),
            ),
          )
        }
        nodes.push(
          React.createElement(
            'button',
            {
              key: 'maximize',
              type: 'button',
              className: 'dsh-tdfi-iconbtn',
              title: `${t(view.maximized === true ? 'restore' : 'maximize')} · ${t('maximizeHint')}`,
              'aria-label': t(view.maximized === true ? 'restore' : 'maximize'),
              'data-maximized': view.maximized === true ? 'true' : undefined,
              onClick: toggleMaximized,
            },
            React.createElement(view.maximized === true ? IconCompactOutlineRegular : IconFullscreenOutlineRegular, { size: 15 }),
          ),
        )
        nodes.push(
          React.createElement(
            'button',
            {
              key: 'window',
              type: 'button',
              className: 'dsh-tdfi-iconbtn',
              title: t('openInWindow'),
              'aria-label': t('openInWindow'),
              onClick: () => {
                openInWindow(tab).catch(() => showToast(t('error')))
              },
            },
            React.createElement(IconRightUpOutlineRegular, { size: 15 }),
          ),
        )
        nodes.push(React.createElement('span', { key: 'divider', className: 'dsh-tdfi-divider' }))
        nodes.push(
          React.createElement(
            'button',
            {
              key: 'close',
              type: 'button',
              className: 'dsh-tdfi-iconbtn',
              title: t('close'),
              'aria-label': t('close'),
              onClick: requestCloseDialog,
            },
            React.createElement(IconCloseOutlineRegular, { size: 15 }),
          ),
        )
        return nodes
      }

      function renderMeta(tab) {
        if (tab === null) return null
        const children = [
          React.createElement(PathLabel, { key: 'path', path: tab.absolutePath, className: 'dsh-tdfi-meta-path' }),
        ]
        if (typeof tab.line === 'number') {
          children.push(React.createElement('span', { key: 'line', className: 'dsh-tdfi-pill' }, t('line', { line: tab.line })))
        }
        if (typeof tab.bytes === 'number' && tab.bytes > 0) {
          children.push(React.createElement('span', { key: 'bytes', className: 'dsh-tdfi-pill' }, fileSizeText(tab.bytes)))
        }
        if (tab.truncated === true) {
          children.push(React.createElement('span', { key: 'cut', className: 'dsh-tdfi-pill' }, t('truncated')))
        }
        return React.createElement('div', { className: 'dsh-tdfi-meta' }, children)
      }

      function renderFooter(tab) {
        if (tab === null) return null
        let dot = 'idle'
        let label = t('previewMode')
        if (tab.phase === 'loading') {
          dot = 'ongoing'
          label = t('loading')
        } else if (tab.phase === 'error') {
          dot = 'error'
          label = t('error')
        } else if (tab.saving === true) {
          dot = 'ongoing'
          label = t('saving')
        } else if (tab.mode === 'edit') {
          dot = tab.dirty === true ? 'warning' : 'idle'
          label = tab.dirty === true ? t('unsaved') : t('saved')
        }
        let hint = ''
        if (tab.phase === 'ready') {
          if (tab.mode === 'edit') hint = t('hintSave')
          else if (canEditTab(tab) && editingSupported) hint = t('hintEdit')
        }
        return React.createElement(
          'div',
          { className: 'dsh-tdfi-foot' },
          React.createElement(
            'div',
            { className: 'dsh-tdfi-state' },
            React.createElement(StateDot, { state: dot }),
            React.createElement('span', { className: 'dsh-tdfi-state-label' }, label),
          ),
          hint === '' ? null : React.createElement('div', { className: 'dsh-tdfi-hint' }, hint),
        )
      }

      function renderBody(tab, bodyRef) {
        if (tab === null) return null
        const children = []
        if (tab.conflict === true) {
          children.push(
            React.createElement(
              'div',
              { key: 'conflict', className: 'dsh-tdfi-banner' },
              React.createElement('span', { className: 'dsh-tdfi-banner-text' }, t('conflict')),
              React.createElement(
                'span',
                { className: 'dsh-tdfi-banner-actions' },
                React.createElement(
                  Button,
                  {
                    size: 'sm',
                    variant: 'outline',
                    onClick: () => {
                      reloadTab(tab.id)
                    },
                  },
                  t('conflictReload'),
                ),
                React.createElement(
                  Button,
                  {
                    size: 'sm',
                    variant: 'primary',
                    onClick: () => {
                      saveTab(tab.id, { force: true })
                    },
                    disabled: tab.saving === true,
                  },
                  t('conflictForce'),
                ),
              ),
            ),
          )
        }
        if (tab.mode === 'edit') {
          children.push(
            React.createElement(components().Editor, {
              key: `${tab.id}:edit`,
              // Mount content keeps an unsaved draft when the tab is revisited;
              // `text` is only the externally loaded content (a conflict reload
              // replaces the document), so drafts never echo back down.
              initialText:
                typeof tab.draft === 'string' ? tab.draft : (typeof tab.text === 'string' ? tab.text : (tab.savedText ?? '')),
              text: typeof tab.text === 'string' ? tab.text : (tab.savedText ?? ''),
              savedText: typeof tab.savedText === 'string' ? tab.savedText : '',
              path: tab.absolutePath,
              initialLine: tab.line,
              onDraft: (value) => setDraft(tab.id, value),
              onDirtyChange: (dirty) => patchTab(tab.id, { editorDirty: dirty === true }),
              onReady: editorReady,
              onMode: (mode, detail) => {
                editorInfo = { mode, detail }
              },
            }),
          )
        } else {
          children.push(
            React.createElement(components().PreviewBody, {
              key: tab.id,
              tab,
              onOpenLinkedFile: openLinkedFile,
              onOpenInWindow: () => {
                openInWindow(tab).catch(() => showToast(t('error')))
              },
            }),
          )
        }
        return React.createElement('div', { className: 'dsh-tdfi-body', ref: bodyRef }, children)
      }

      function renderConfirm(confirm) {
        if (confirm === null) return null
        const active = findTab(confirm.tabId)
        const canSave = confirm.kind !== 'cancelEdit' && active !== null && active.mode === 'edit'
        return React.createElement(components().ConfirmOverlay, {
          confirm,
          t,
          busy: active !== null && active.saving === true,
          onCancel: cancelConfirm,
          onDiscard: discardConfirm,
          onSave: canSave ? saveConfirm : undefined,
        })
      }

      function handleDialogKeys(event) {
        const current = activeTab()
        const modifier = event.metaKey || event.ctrlKey
        if (modifier && (event.key === 's' || event.key === 'S')) {
          event.preventDefault()
          event.stopPropagation()
          if (current !== null && current.mode === 'edit') saveTab(current.id)
          return
        }
        if (modifier && (event.key === 'e' || event.key === 'E')) {
          event.preventDefault()
          event.stopPropagation()
          if (current !== null) setMode(current.id, current.mode === 'edit' ? 'preview' : 'edit')
          return
        }
        if (modifier && event.shiftKey === true && (event.key === 'm' || event.key === 'M')) {
          event.preventDefault()
          event.stopPropagation()
          toggleMaximized()
          return
        }
        if (event.key === 'Escape' && view.confirm !== null) {
          event.preventDefault()
          event.stopPropagation()
          setView({ confirm: null })
        }
      }

      const Viewer = () => {
        const current = React.useSyncExternalStore(subscribeView, getView)
        const active = current.tabs.find((tab) => tab.id === current.activeId) ?? null
        const bodyRef = React.useRef(null)
        const targetLine = active === null ? undefined : active.line
        const targetText = active === null ? undefined : active.text
        const targetPhase = active === null ? undefined : active.phase
        const targetMode = active === null ? undefined : active.mode
        const targetKind = active === null ? undefined : active.kind

        // The code view highlights asynchronously; retry the jump while the DOM settles.
        React.useEffect(() => {
          if (typeof targetLine !== 'number' || targetMode !== 'preview' || targetKind !== 'code') return undefined
          const scroll = components().scrollTexture
          const timers = LINE_SCROLL_DELAYS.map((delay) =>
            setTimeout(() => {
              scroll(bodyRef.current, targetLine)
            }, delay),
          )
          return () => {
            for (const id of timers) clearTimeout(id)
          }
        }, [targetLine, targetText, targetPhase, targetMode, targetKind])

        if (current.tabs.length === 0 || chunks === null) return null
        return React.createElement(
          Modal,
          {
            open: true,
            headless: true,
            onClose: requestCloseDialog,
            title: active === null ? t('title') : active.fileName,
            className: current.maximized === true ? 'dsh-tdfi-dialog dsh-tdfi-maximized' : 'dsh-tdfi-dialog',
            backdropBlur: false,
          },
          React.createElement(
            'div',
            { className: 'dsh-tdfi-shell', onKeyDownCapture: handleDialogKeys },
            React.createElement(
              'div',
              { className: 'dsh-tdfi-head' },
              React.createElement(components().TabStrip, {
                tabs: current.tabs,
                activeId: current.activeId,
                onActivate: activateTab,
                onClose: requestCloseTab,
                t,
              }),
              React.createElement('div', { className: 'dsh-tdfi-actions' }, renderActions(active)),
            ),
            renderMeta(active),
            renderBody(active, bodyRef),
            renderFooter(active),
            renderConfirm(current.confirm),
          ),
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

      const Overlay = () => {
        // Loading the chunks is asynchronous; re-render once they are in.
        const [, bump] = React.useState(0)
        React.useEffect(() => {
          let live = true
          ensureChunks()
            .then(() => {
              if (live) bump((value) => value + 1)
            })
            .catch((error) => {
              console.warn('[dsh-thoughtdag-file-open] chunks failed to load:', error)
            })
          return () => {
            live = false
          }
        }, [])
        return React.createElement(React.Fragment, null, React.createElement(Viewer), React.createElement(ToastHost))
      }

      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register({ name: 'shell.overlay', id: NS, order: 60, locale: NS }, Overlay),
      )

      // ── stylesheet, owned by this plugin and removed with it ───────────────
      ctx.effect(() => {
        let style = null
        let disposed = false
        ensureChunks()
          .then((loaded) => {
            if (disposed) return
            style = document.createElement('style')
            style.setAttribute('data-plugin', NS)
            style.textContent = loaded.styles.CSS
            document.head.append(style)
          })
          .catch(() => {
            // the viewer still works without custom chrome
          })
        return () => {
          disposed = true
          style?.remove()
          style = null
        }
      }, 'dsh-thoughtdag-file-open: stylesheet')

      // ── the canvas link bridge ────────────────────────────────────────────
      ctx.effect(() => {
        let unbind = null
        let disposed = false
        ensureChunks()
          .then((loaded) => {
            if (disposed) return
            unbind = installFrameBridge(loaded.util, openCanvasTarget)
          })
          .catch(() => {
            // a broken chunk load must not break the page
          })
        return () => {
          disposed = true
          unbind?.()
          unbind = null
        }
      }, 'dsh-thoughtdag-file-open: canvas links')

      // ── manual handle (verification and debugging from the page devtools) ──
      try {
        window.__dshThoughtdagFileOpen = {
          version: '3.0.0',
          open(href) {
            return ensureChunks().then((loaded) => {
              const classified = loaded.util.classifyHref(String(href))
              return classified === null ? false : openCanvasTarget(classified)
            })
          },
          async openAbsolute(path, options) {
            const { remote } = await hostApi()
            const snapshot = remote.sessionSnapshot()
            const sessionId = options?.sessionId ?? snapshot.currentId
            if (sessionId === undefined) return false
            const hit = await remote.stat(sessionId, String(path))
            if (hit === null) return false
            await openHit(
              { sessionId, absolutePath: typeof hit.absolutePath === 'string' ? hit.absolutePath : String(path) },
              options?.line,
            )
            return true
          },
          state: () => view,
          active: () => activeTab(),
          tabs: () => view.tabs.map((tab) => ({
            id: tab.id,
            fileName: tab.fileName,
            phase: tab.phase,
            kind: tab.kind,
            mode: tab.mode,
            dirty: tab.dirty === true,
            version: tab.version,
            sessionId: tab.sessionId,
          })),
          edit: () => {
            const tab = activeTab()
            return tab === null ? Promise.resolve(false) : setMode(tab.id, 'edit')
          },
          preview: () => {
            const tab = activeTab()
            return tab === null ? Promise.resolve(false) : setMode(tab.id, 'preview')
          },
          draft: (text) => {
            const tab = activeTab()
            if (tab !== null) setDraft(tab.id, String(text))
          },
          closeTab: (id) => requestCloseTab(id),
          close: () => requestCloseDialog(),
          forceCloseAll: () => closeAllNow(),
          save: () => {
            const tab = activeTab()
            return tab === null ? Promise.resolve(false) : saveTab(tab.id)
          },
          saveForce: () => {
            const tab = activeTab()
            return tab === null ? Promise.resolve(false) : saveTab(tab.id, { force: true })
          },
          confirmDiscard: () => discardConfirm(),
          confirmSave: () => saveConfirm(),
          confirmCancel: () => cancelConfirm(),
          editingSupported: () => editingSupported,
          toggleMaximize: () => {
            toggleMaximized()
            return view.maximized === true
          },
          editorDiagnostics: () => ({
            ...editorInfo,
            ...(editorApi?.diagnostics?.() ?? {}),
          }),
          chunksLoaded: () => chunks !== null,
          ready: () => ensureChunks().then(() => true),
        }
        ctx.effect(
          () => () => {
            closeAllNow()
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
