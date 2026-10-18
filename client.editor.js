// dsh-thoughtdag-file-open — chunk: the in-place editor.
//
// The body is a vendored CodeMirror 6 bundle (package root
// `client.codemirror.js`, loaded lazily on the first Edit click) themed with
// DSH tokens and the Harness's own `--shiki-*` syntax palette, so highlighted
// code in the dialog matches the chat's code blocks. If the vendor chunk or the
// full extension set cannot start, a minimal CodeMirror setup is tried first; a
// plain textarea with a visible notice is the last resort.
//
// The component owns the document while it is mounted; the entry module owns
// the tab (draft, dirty flag, save). Draft text reaches the entry debounced and
// synchronously on `flush()`, so a save, a tab switch or a close never loses
// keystrokes. External content (a conflict reload) arrives through the `text`
// prop and is applied without echoing drafts back down.
window.__ModuleLoader__.load({
  id: 'dsh-thoughtdag-file-open',
  chunk: 'client.editor.js',
  factory: (require) => {
    const React = require('react')
    const module = { exports: {} }

    /** Quiet period before a keystroke reaches the entry's draft state. */
    const DRAFT_DEBOUNCE_MS = 250
    const LINE_HEIGHT = 20
    const PADDING_TOP = 12

    function extensionOf(path) {
      const normalized = String(path).replace(/\\/g, '/').replace(/\/+$/, '')
      const cut = normalized.lastIndexOf('/')
      const base = cut === -1 ? normalized : normalized.slice(cut + 1)
      const dot = base.lastIndexOf('.')
      return dot <= 0 || dot === base.length - 1 ? '' : base.slice(dot + 1).toLowerCase()
    }

    /** The Harness marks the dark theme with `body[data-ds-dark-theme]`. */
    function isDarkTheme() {
      if (typeof document === 'undefined' || document.body === null || document.body === undefined) return false
      return document.body.hasAttribute('data-ds-dark-theme')
    }

    function isMarkdownPath(path) {
      const extension = extensionOf(path)
      return (
        extension === 'md' ||
        extension === 'markdown' ||
        extension === 'mdown' ||
        extension === 'mkd' ||
        extension === 'mkdn' ||
        extension === 'mdwn'
      )
    }

    function errorText(error) {
      return error instanceof Error ? error.message : String(error)
    }

    // One shared load for the whole page: the entry prefetches it while the
    // user reads a text preview, and every editor reuses the materialized chunk.
    let vendorPromise = null

    function loadCodeMirror() {
      if (vendorPromise === null) {
        vendorPromise = require.async('./client.codemirror.js').catch((error) => {
          vendorPromise = null
          throw error
        })
      }
      return vendorPromise
    }

    /**
     * Build the editor components.
     *
     * @param options.t - locale translator bound to this plugin's namespace.
     */
    function createEditor({ t }) {

      // ── CodeMirror theming (DSH tokens + Harness Shiki palette) ───────────
      function highlightStyle(cm) {
        const tags = cm.tags
        return cm.HighlightStyle.define([
          {
            tag: [
              tags.keyword,
              tags.controlKeyword,
              tags.definitionKeyword,
              tags.moduleKeyword,
              tags.operatorKeyword,
              tags.self,
            ],
            color: 'var(--shiki-token-keyword, #faa2c1)',
          },
          {
            tag: [tags.string, tags.special(tags.string), tags.regexp, tags.character, tags.attributeValue],
            color: 'var(--shiki-token-string, #69db7c)',
          },
          {
            tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment],
            color: 'var(--shiki-token-comment, #adb5bd)',
            fontStyle: 'italic',
          },
          {
            tag: [tags.number, tags.bool, tags.null, tags.atom, tags.constant(tags.name), tags.standard(tags.name)],
            color: 'var(--shiki-token-constant, #4dabf7)',
          },
          {
            tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.macroName],
            color: 'var(--shiki-token-function, #b197fc)',
          },
          { tag: [tags.typeName, tags.className, tags.namespace, tags.tagName], color: 'var(--shiki-token-function)' },
          { tag: [tags.propertyName, tags.attributeName], color: 'var(--shiki-token-constant)' },
          {
            tag: [tags.punctuation, tags.bracket, tags.separator, tags.operator],
            color: 'var(--shiki-token-punctuation, #ced4da)',
          },
          { tag: [tags.link, tags.url, tags.escape], color: 'var(--shiki-token-link)' },
          { tag: [tags.meta, tags.processingInstruction], color: 'var(--shiki-token-comment)' },
          { tag: tags.heading, color: 'var(--dsw-alias-label-primary)', fontWeight: '600' },
          { tag: tags.emphasis, fontStyle: 'italic' },
          { tag: tags.strong, fontWeight: '600' },
          { tag: tags.strikethrough, textDecoration: 'line-through' },
          { tag: tags.invalid, color: 'var(--dsw-alias-state-error-primary)' },
        ])
      }

      function editorTheme(cm, dark) {
        return cm.EditorView.theme(
          {
            '&': {
              height: '100%',
              backgroundColor: 'var(--dsw-alias-bg-layer-1)',
              color: 'var(--dsw-alias-label-primary)',
              fontSize: '13px',
            },
            '&.cm-focused': { outline: 'none' },
            '.cm-scroller': {
              fontFamily: 'var(--ds-font-family-code)',
              lineHeight: `${String(LINE_HEIGHT)}px`,
              overflow: 'auto',
            },
            '.cm-content': {
              padding: `${String(PADDING_TOP)}px 0 40px`,
              caretColor: 'var(--dsw-alias-brand-primary)',
            },
            '.cm-line': { padding: '0 16px 0 8px' },
            '.cm-gutters': {
              backgroundColor: 'var(--dsw-alias-bg-layer-2)',
              color: 'var(--dsw-alias-label-tertiary)',
              borderRight: '0.5px solid var(--dsw-alias-border-l1)',
            },
            '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 14px' },
            '.cm-foldGutter .cm-gutterElement': { padding: '0 4px', color: 'var(--dsw-alias-label-tertiary)' },
            '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--dsw-alias-label-primary)' },
            '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--dsw-alias-label-primary) 4%, transparent)' },
            '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
              backgroundColor: 'var(--dsw-alias-bg-document-selection)',
            },
            '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--dsw-alias-brand-primary)' },
            '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
              backgroundColor: 'color-mix(in srgb, var(--dsw-alias-brand-primary) 20%, transparent)',
              outline: 'none',
            },
            '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent)' },
            '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--dsw-alias-state-warn-primary) 22%, transparent)' },
            '.cm-searchMatch.cm-searchMatch-selected': {
              backgroundColor: 'color-mix(in srgb, var(--dsw-alias-state-warn-primary) 40%, transparent)',
            },
            '.cm-panels': { backgroundColor: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)' },
            '.cm-panels.cm-panels-top': { borderBottom: '0.5px solid var(--dsw-alias-border-l1)' },
            '.cm-panels.cm-panels-bottom': { borderTop: '0.5px solid var(--dsw-alias-border-l1)' },
            '.cm-panel.cm-search': { padding: '8px 12px', fontFamily: 'var(--dsw-font-family)', fontSize: '12px' },
            '.cm-panel.cm-search input, .cm-panel.cm-search button, .cm-panel.cm-search label': {
              fontFamily: 'inherit',
              fontSize: '12px',
              color: 'var(--dsw-alias-label-primary)',
            },
            '.cm-textfield': {
              backgroundColor: 'var(--dsw-alias-bg-layer-1)',
              border: '0.5px solid var(--dsw-alias-border-l3)',
              borderRadius: 'var(--dsw-radius-sm)',
              color: 'var(--dsw-alias-label-primary)',
            },
            '.cm-button': {
              backgroundColor: 'var(--dsw-alias-bg-layer-3)',
              backgroundImage: 'none',
              border: '0.5px solid var(--dsw-alias-border-l3)',
              borderRadius: 'var(--dsw-radius-sm)',
              color: 'var(--dsw-alias-label-primary)',
            },
            '.cm-button:hover': { backgroundColor: 'var(--dsw-alias-interactive-bg-hover)' },
            '.cm-tooltip': {
              backgroundColor: 'var(--dsw-alias-bg-overlay)',
              border: '0.5px solid var(--dsw-alias-border-l3)',
              borderRadius: 'var(--dsw-radius-md)',
              boxShadow: 'var(--dsw-elevation-prominent)',
              color: 'var(--dsw-alias-label-primary)',
            },
            '.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--ds-font-family-code)', fontSize: '12px' },
            '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
              backgroundColor: 'var(--dsw-alias-interactive-bg-hover)',
              color: 'var(--dsw-alias-label-primary)',
            },
            '.cm-foldPlaceholder': {
              backgroundColor: 'var(--dsw-alias-bg-layer-3)',
              border: '0.5px solid var(--dsw-alias-border-l3)',
              borderRadius: 'var(--dsw-radius-xs)',
              color: 'var(--dsw-alias-label-secondary)',
            },
          },
          { dark },
        )
      }

      function languageSupport(cm, path) {
        switch (extensionOf(path)) {
          case 'md':
          case 'markdown':
          case 'mdown':
          case 'mkd':
          case 'mkdn':
          case 'mdwn':
            return cm.markdown({ base: cm.markdownLanguage, extensions: cm.GFM })
          case 'js':
          case 'mjs':
          case 'cjs':
            return cm.javascript()
          case 'jsx':
            return cm.javascript({ jsx: true })
          case 'ts':
          case 'mts':
          case 'cts':
            return cm.javascript({ typescript: true })
          case 'tsx':
            return cm.javascript({ typescript: true, jsx: true })
          case 'json':
          case 'jsonc':
          case 'json5':
            return cm.json()
          case 'py':
          case 'pyw':
          case 'pyi':
            return cm.python()
          case 'html':
          case 'htm':
          case 'xhtml':
            return cm.html()
          case 'css':
          case 'scss':
          case 'less':
            return cm.css()
          case 'xml':
          case 'svg':
          case 'xul':
          case 'plist':
            return cm.xml()
          case 'yaml':
          case 'yml':
            return cm.yaml()
          case 'sql':
            return cm.sql()
          case 'sh':
          case 'bash':
          case 'zsh':
          case 'fish':
          case 'shell':
            return cm.StreamLanguage.define(cm.shell)
          default:
            return null
        }
      }

      /**
       * Extensions shared by the full setup and the minimal retry. Multi-cursor
       * lives here because it costs nothing and must survive a degraded mount.
       */
      function coreExtensions(cm, options) {
        const extensions = [
          cm.EditorState.allowMultipleSelections.of(true),
          cm.EditorView.clickAddsSelectionRange.of((event) => event.altKey === true),
          cm.lineNumbers(),
          cm.history(),
          cm.drawSelection(),
          cm.highlightActiveLine(),
          cm.syntaxHighlighting(highlightStyle(cm)),
          cm.EditorState.tabSize.of(2),
          cm.indentUnit.of('  '),
          cm.keymap.of([...cm.defaultKeymap, ...cm.historyKeymap, ...cm.closeBracketsKeymap, cm.indentWithTab]),
          options.themeCompartment.of(editorTheme(cm, isDarkTheme())),
          options.escapeGuard,
          options.updateListener,
        ]
        if (options.wrap) extensions.unshift(cm.EditorView.lineWrapping)
        return extensions
      }

      function fullExtensions(cm, options) {
        const extensions = coreExtensions(cm, options)
        extensions.push(
          cm.highlightActiveLineGutter(),
          cm.highlightSpecialChars(),
          cm.foldGutter(),
          cm.dropCursor(),
          cm.indentOnInput(),
          cm.bracketMatching(),
          cm.closeBrackets(),
          cm.autocompletion(),
          cm.rectangularSelection(),
          cm.crosshairCursor(),
          cm.search(),
          cm.keymap.of([...cm.searchKeymap, ...cm.foldKeymap, ...cm.completionKeymap]),
          cm.EditorView.contentAttributes.of({
            'aria-label': t('editorLabel'),
            spellcheck: 'false',
            autocapitalize: 'off',
            autocomplete: 'off',
          }),
        )
        const language = languageSupport(cm, options.path)
        if (language !== null) extensions.push(language)
        return extensions
      }

      // ── the CodeMirror-backed editor ─────────────────────────────────────
      function CodeMirrorEditor({
        initialText,
        text,
        savedText,
        initialLine,
        path,
        onDraft,
        onDirtyChange,
        onReady,
        onStatus,
      }) {
        const hostRef = React.useRef(null)
        const apiRef = React.useRef(null)
        const callbacks = React.useRef({ onDraft, onDirtyChange, onReady })
        callbacks.current = { onDraft, onDirtyChange, onReady }

        React.useEffect(() => {
          let disposed = false
          let view = null
          let observer = null
          let draftTimer = 0
          let baseline = typeof savedText === 'string' ? savedText : ''
          let dirty = false
          let failure = null
          let keyAt = 0
          const latency = []

          function emitDraft() {
            if (view === null) return
            callbacks.current.onDraft?.(view.state.doc.toString())
          }

          function scheduleDraft() {
            if (draftTimer !== 0) clearTimeout(draftTimer)
            draftTimer = setTimeout(() => {
              draftTimer = 0
              emitDraft()
            }, DRAFT_DEBOUNCE_MS)
          }

          function markDirty(next) {
            if (next === dirty) return
            dirty = next
            callbacks.current.onDirtyChange?.(dirty)
          }

          function latencyReport() {
            if (latency.length === 0) return null
            const sorted = latency.slice().sort((a, b) => a - b)
            return {
              samples: sorted.length,
              p50: Math.round(sorted[Math.floor(sorted.length * 0.5)] * 10) / 10,
              p95: Math.round(sorted[Math.floor(sorted.length * 0.95)] * 10) / 10,
              max: Math.round(sorted[sorted.length - 1] * 10) / 10,
            }
          }

          loadCodeMirror()
            .then((cm) => {
              if (disposed) return
              const host = hostRef.current
              if (host === null) return
              const contents = typeof initialText === 'string' ? initialText : ''
              const themeCompartment = new cm.Compartment()

              const escapeGuard = cm.EditorView.domEventHandlers({
                keydown(event) {
                  if (event.key === 'Escape' && view !== null) {
                    const search = view.dom.querySelector('.cm-search')
                    const completion = view.dom.querySelector('.cm-tooltip-autocomplete')
                    if (search !== null || completion !== null) {
                      event.preventDefault()
                      event.stopPropagation()
                      if (search !== null) {
                        try {
                          cm.closeSearchPanel(view)
                        } catch {
                          // the panel already closed
                        }
                      }
                      return true
                    }
                    return false
                  }
                  keyAt = performance.now()
                  return false
                },
              })

              const updateListener = cm.EditorView.updateListener.of((update) => {
                if (!update.docChanged) return
                if (keyAt !== 0) {
                  latency.push(performance.now() - keyAt)
                  if (latency.length > 120) latency.shift()
                  keyAt = 0
                }
                const doc = update.state.doc
                markDirty(doc.length === baseline.length ? doc.toString() !== baseline : true)
                scheduleDraft()
              })

              const options = { path, wrap: isMarkdownPath(path), themeCompartment, escapeGuard, updateListener }
              const mount = (extensions) => {
                try {
                  return new cm.EditorView({ doc: contents, extensions, parent: host })
                } catch (error) {
                  failure = errorText(error)
                  console.warn('[thoughtdag-file-open] CodeMirror setup failed:', error)
                  return null
                }
              }

              view = mount(fullExtensions(cm, options))
              if (view === null) {
                // One extension may be the problem; keep CodeMirror alive with
                // the core set (highlighting, multi-cursor, history, theme).
                host.textContent = ''
                view = mount(coreExtensions(cm, options))
              }
              if (view === null) {
                onStatus?.('fallback', failure)
                return
              }

              // Start on the line a `#L92` link asked for.
              const wanted = typeof initialLine === 'number' && Number.isFinite(initialLine) ? Math.floor(initialLine) : 1
              const lineNumber = Math.min(Math.max(1, wanted), view.state.doc.lines)
              const line = view.state.doc.line(lineNumber)
              view.dispatch({
                selection: { anchor: line.from },
                effects: cm.EditorView.scrollIntoView(line.from, { y: 'center' }),
              })
              try {
                view.focus({ preventScroll: true })
              } catch {
                view.focus()
              }

              if (typeof MutationObserver === 'function' && document.body !== null) {
                observer = new MutationObserver(() => {
                  if (view === null) return
                  view.dispatch({ effects: themeCompartment.reconfigure(editorTheme(cm, isDarkTheme())) })
                })
                observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
              }

              const api = {
                getText: () => (view === null ? contents : view.state.doc.toString()),
                flush: () => {
                  if (draftTimer !== 0) {
                    clearTimeout(draftTimer)
                    draftTimer = 0
                  }
                  const value = view === null ? contents : view.state.doc.toString()
                  callbacks.current.onDraft?.(value)
                  return value
                },
                setBaseline: (value) => {
                  if (typeof value !== 'string' || view === null) return
                  baseline = value
                  markDirty(view.state.doc.toString() !== baseline)
                },
                setText: (value) => {
                  if (typeof value !== 'string' || view === null) return
                  if (value === view.state.doc.toString()) return
                  baseline = value
                  dirty = false
                  callbacks.current.onDirtyChange?.(false)
                  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
                  emitDraft()
                },
                focus: () => {
                  view?.focus()
                },
                diagnostics: () => ({
                  mode: 'codemirror',
                  docLength: view === null ? 0 : view.state.doc.length,
                  docLines: view === null ? 0 : view.state.doc.lines,
                  selections: view === null ? 0 : view.state.selection.ranges.length,
                  multiCursor: view !== null && view.state.facet(cm.EditorState.allowMultipleSelections) === true,
                  latency: latencyReport(),
                }),
              }
              apiRef.current = api
              if (contents !== baseline) markDirty(true)
              callbacks.current.onReady?.(api)
              console.info('[thoughtdag-file-open] editor ready', {
                mode: 'codemirror',
                lines: view.state.doc.lines,
                multiCursor: view.state.facet(cm.EditorState.allowMultipleSelections) === true,
              })
              onStatus?.('ready')
            })
            .catch((error) => {
              console.error('[thoughtdag-file-open] CodeMirror unavailable, using the plain editor:', error)
              failure = errorText(error)
              if (!disposed) onStatus?.('fallback', failure)
            })

          return () => {
            disposed = true
            if (draftTimer !== 0) {
              clearTimeout(draftTimer)
              draftTimer = 0
            }
            observer?.disconnect()
            observer = null
            if (apiRef.current !== null) {
              apiRef.current = null
              callbacks.current.onReady?.(null)
            }
            view?.destroy()
            view = null
          }
          // The editor mounts once per tab key; text/baseline updates flow
          // through the two effects below instead of rebuilding the view.
          // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [])

        // External content (a conflict reload) replaces the document. Drafts
        // never flow back down, so typing does not trigger this.
        React.useEffect(() => {
          if (apiRef.current === null) return
          apiRef.current.setText(typeof text === 'string' ? text : '')
        }, [text])

        // A successful save moves the dirty baseline.
        React.useEffect(() => {
          if (apiRef.current === null) return
          apiRef.current.setBaseline(typeof savedText === 'string' ? savedText : '')
        }, [savedText])

        return React.createElement('div', { className: 'dsh-tdfi-cm-host', ref: hostRef })
      }

      // ── plain-text fallback (vendor chunk unavailable) ──────────────────
      function FallbackEditor({ text, savedText, initialLine, onDraft, onDirtyChange }) {
        const initial = typeof text === 'string' ? text : ''
        const baseline = typeof savedText === 'string' ? savedText : initial
        const [value, setValue] = React.useState(initial)
        const textareaRef = React.useRef(null)
        const gutterRef = React.useRef(null)
        const lineCount = value.length === 0 ? 1 : value.split('\n').length
        const digits = String(lineCount).length

        const syncGutter = React.useCallback(() => {
          const textarea = textareaRef.current
          const gutter = gutterRef.current
          if (textarea === null || gutter === null) return
          gutter.scrollTop = textarea.scrollTop
        }, [])

        React.useEffect(() => {
          const textarea = textareaRef.current
          if (textarea === null) return
          try {
            textarea.focus({ preventScroll: true })
          } catch {
            textarea.focus()
          }
          if (typeof initialLine === 'number' && initialLine > 1) {
            textarea.scrollTop = Math.max(0, (initialLine - 1) * LINE_HEIGHT - textarea.clientHeight / 2 + PADDING_TOP)
            syncGutter()
          }
          // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [])

        const handleChange = (event) => {
          const next = event.currentTarget.value
          setValue(next)
          onDraft?.(next)
          onDirtyChange?.(next !== baseline)
        }

        const handleKeyDown = (event) => {
          if (event.key !== 'Tab') return
          event.preventDefault()
          const textarea = event.currentTarget
          const start = textarea.selectionStart
          const end = textarea.selectionEnd
          const inserted = '  '
          const next = `${value.slice(0, start)}${inserted}${value.slice(end)}`
          setValue(next)
          onDraft?.(next)
          onDirtyChange?.(next !== baseline)
          requestAnimationFrame(() => {
            const target = textareaRef.current
            if (target === null) return
            target.selectionStart = start + inserted.length
            target.selectionEnd = start + inserted.length
          })
        }

        const gutter = React.useMemo(() => {
          const numbers = []
          for (let line = 1; line <= lineCount; line += 1) numbers.push(line)
          return numbers.join('\n')
        }, [lineCount])

        return React.createElement(
          'div',
          { className: 'dsh-tdfi-editor-fallback' },
          React.createElement(
            'div',
            {
              ref: gutterRef,
              className: 'dsh-tdfi-gutter',
              'aria-hidden': 'true',
              style: { width: `${String(Math.max(3, digits) + 1)}ch` },
            },
            gutter,
          ),
          React.createElement('textarea', {
            ref: textareaRef,
            className: 'dsh-tdfi-textarea',
            value,
            onChange: handleChange,
            onKeyDown: handleKeyDown,
            onScroll: syncGutter,
            spellCheck: false,
            autoCapitalize: 'off',
            autoCorrect: 'off',
            autoComplete: 'off',
            wrap: 'off',
            'aria-label': t('editorLabel'),
            'data-modal-autofocus': true,
          }),
        )
      }

      /** The editor surface for one tab: CodeMirror when available, textarea otherwise. */
      function Editor(props) {
        const [status, setStatus] = React.useState('loading')
        const [failure, setFailure] = React.useState(null)
        const onMode = props.onMode

        const handleStatus = React.useCallback(
          (next, detail) => {
            setStatus(next)
            if (detail !== undefined) setFailure(detail === null ? null : String(detail))
            onMode?.(next, detail === undefined ? null : detail)
          },
          [onMode],
        )

        return React.createElement(
          'div',
          { className: 'dsh-tdfi-editor', 'data-mode': status },
          status === 'fallback'
            ? React.createElement(FallbackEditor, {
                text: props.initialText,
                savedText: props.savedText,
                initialLine: props.initialLine,
                onDraft: props.onDraft,
                onDirtyChange: props.onDirtyChange,
              })
            : React.createElement(CodeMirrorEditor, { ...props, onStatus: handleStatus }),
          status === 'loading' ? React.createElement('div', { className: 'dsh-tdfi-cm-loading' }, t('loading')) : null,
          status === 'fallback' && failure !== null
            ? React.createElement(
                'div',
                { className: 'dsh-tdfi-editor-notice', role: 'status' },
                t('editorFallback', { message: failure }),
              )
            : null,
        )
      }

      return { Editor }
    }

    module.exports = { createEditor, isDarkTheme, prefetchCodeMirror: loadCodeMirror }
    return module.exports
  },
})
