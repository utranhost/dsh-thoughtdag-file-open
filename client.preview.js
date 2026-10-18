// dsh-thoughtdag-file-open — chunk: read-only preview bodies.
//
// Each view is drawn with the same DSH primitives the chat uses, so a Markdown
// document, a code buffer, an image or a PDF looks like it belongs to the
// Harness. Binary and Office previews keep the "open in the document window"
// fallback the previous version offered.
window.__ModuleLoader__.load({
  id: 'dsh-thoughtdag-file-open',
  chunk: 'client.preview.js',
  factory: (require) => {
    const React = require('react')
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    const module = { exports: {} }

    /**
     * Scroll a rendered code block to a 1-based line.
     *
     * The highlighter fills the block asynchronously, so owners retry this over
     * a short window after the tab becomes active.
     *
     * @returns whether a matching line node was found.
     */
    function scrollCodeToLine(root, line) {
      if (typeof line !== 'number' || line < 1 || root === null || root === undefined) return false
      const nodes = root.querySelectorAll('[data-code-block-content] .line')
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

    /**
     * Build the preview renderers.
     *
     * @param options.util - the pure helper chunk.
     * @param options.t - locale translator bound to this plugin's namespace.
     */
    function createPreview({ util, t }) {
      const {
        CodeBlock,
        FileTypeIcon,
        MarkdownDelegateProvider,
        MarkdownText,
        StateDot,
      } = primitives

      const codeToolbarLabels = () => ({ codeLabel: t('code'), wrapLabel: t('wrap'), unwrapLabel: t('unwrap') })
      const markdownLabels = () => ({
        code: { copyLabel: t('copy'), copiedLabel: t('copied'), toolbarLabels: codeToolbarLabels() },
        footnotes: t('footnotes'),
      })

      /** Resolve a document-relative image path into an authenticated file URL. */
      function imageResolverFor(tab) {
        return {
          resolve(value) {
            try {
              const clean = util.normalizeTargetPath(util.decodeLoose(String(value).split(/[?#]/)[0]))
              if (clean === '') return undefined
              const absolute = util.isAbsolutePath(clean) ? clean : util.joinPath(util.dirnameOf(tab.absolutePath), clean)
              if (!util.isAbsolutePath(absolute)) return undefined
              return new URL(`api/file?path=${encodeURIComponent(absolute)}`, document.baseURI).href
            } catch {
              return undefined
            }
          },
        }
      }

      function Loading() {
        return React.createElement(
          'div',
          { className: 'dsh-tdfi-loading', role: 'status' },
          React.createElement(StateDot, { state: 'ongoing' }),
          React.createElement('span', null, t('loading')),
        )
      }

      function reasonKey(reason) {
        if (reason === 'office') return 'unsupportedOffice'
        if (reason === 'tooLarge') return 'unsupportedTooLarge'
        if (reason === 'readFailed') return 'unsupportedReadFailed'
        return 'unsupportedBinary'
      }

      function Unsupported({ tab, onOpenInWindow }) {
        const fallback = tab.phase === 'error' || tab.kind === 'unsupported' || tab.origin === 'office'
        return React.createElement(
          'div',
          { className: 'dsh-tdfi-empty' },
          React.createElement(FileTypeIcon, { path: tab.absolutePath, size: 44 }),
          React.createElement(
            'div',
            null,
            tab.phase === 'error' ? tab.error ?? t('error') : t(reasonKey(tab.reason)),
          ),
          fallback
            ? React.createElement(
                'div',
                { className: 'dsh-tdfi-empty-actions' },
                React.createElement(primitives.Button, { variant: 'outline', size: 'sm', onClick: onOpenInWindow }, t('openInWindow')),
              )
            : null,
        )
      }

      function PreviewBody({ tab, onOpenLinkedFile, onOpenInWindow }) {
        // MarkdownText keys its render cache on the labels identity; keep it
        // stable so a re-render of the dialog does not re-render the document.
        const docLabels = React.useMemo(() => markdownLabels(), [])
        const images = React.useMemo(() => (tab.kind === 'markdown' ? imageResolverFor(tab) : undefined), [tab.kind, tab.absolutePath])
        if (tab.phase === 'loading') {
          return React.createElement(
            'div',
            { className: 'dsh-tdfi-scroll' },
            React.createElement(Loading),
          )
        }
        if (tab.phase === 'error') {
          return React.createElement('div', { className: 'dsh-tdfi-error' }, tab.error ?? t('error'))
        }
        if (tab.kind === 'markdown') {
          return React.createElement(
            React.Fragment,
            null,
            React.createElement(
              'div',
              { className: 'dsh-tdfi-scroll', 'data-kind': 'markdown' },
              React.createElement(
                'div',
                { className: 'dsh-tdfi-md' },
                React.createElement(
                  MarkdownDelegateProvider,
                  {
                    openExternalLink: (url) => {
                      try {
                        window.open(url, '_blank', 'noopener,noreferrer')
                      } catch {
                        // a blocked popup leaves the page where it is
                      }
                    },
                    openFile: (path, options) => onOpenLinkedFile(tab, path, options),
                  },
                  React.createElement(MarkdownText, {
                    text: tab.text ?? '',
                    labels: docLabels,
                    pathImages: images,
                  }),
                ),
              ),
            ),
            tab.truncated === true ? React.createElement('div', { className: 'dsh-tdfi-note' }, t('truncated')) : null,
          )
        }
        if (tab.kind === 'code') {
          return React.createElement(
            React.Fragment,
            null,
            React.createElement(
              'div',
              { className: 'dsh-tdfi-scroll', 'data-kind': 'code' },
              React.createElement(
                'div',
                { className: 'dsh-tdfi-code' },
                React.createElement(CodeBlock, {
                  code: tab.text ?? '',
                  lang: tab.language,
                  lineNumbers: true,
                  copyLabel: t('copy'),
                  copiedLabel: t('copied'),
                  toolbarLabels: codeToolbarLabels(),
                }),
              ),
            ),
            tab.truncated === true ? React.createElement('div', { className: 'dsh-tdfi-note' }, t('truncated')) : null,
          )
        }
        if (tab.kind === 'image') {
          return React.createElement(
            'div',
            { className: 'dsh-tdfi-media' },
            React.createElement('img', { src: tab.url, alt: tab.fileName, decoding: 'async' }),
          )
        }
        if (tab.kind === 'pdf') {
          return React.createElement('iframe', {
            className: 'dsh-tdfi-frame',
            src: tab.url,
            title: tab.fileName,
          })
        }
        if (tab.kind === 'html') {
          return React.createElement('iframe', {
            className: 'dsh-tdfi-frame',
            src: tab.url,
            title: tab.fileName,
            sandbox: '',
          })
        }
        return React.createElement(Unsupported, { tab, onOpenInWindow })
      }

      return { PreviewBody, scrollCodeToLine }
    }

    module.exports = { createPreview, scrollCodeToLine }
    return module.exports
  },
})
