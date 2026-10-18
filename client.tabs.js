// dsh-thoughtdag-file-open — chunk: the tab strip and the
// unsaved-changes confirmation card.
//
// Both are pure presentation: the entry module owns the tab state and passes
// callbacks down, so this chunk can be tested and restyled without touching
// the file-loading or Host-write paths.
window.__ModuleLoader__.load({
  id: 'dsh-thoughtdag-file-open',
  chunk: 'client.tabs.js',
  factory: (require) => {
    const React = require('react')
    const module = { exports: {} }

    /**
     * Build the tab-strip and confirmation components.
     *
     * @param options.primitives - DSH UI primitives (FileTypeIcon, Button, icons).
     */
    function createTabs({ primitives }) {
      const { FileTypeIcon, Button, IconCloseOutlineRegular } = primitives

      /** One open file; the close control is a real button beside the tab role. */
      function Tab({ tab, active, onActivate, onClose, t }) {
        const activate = () => onActivate(tab.id)
        return React.createElement(
          'div',
          {
            role: 'tab',
            'aria-selected': active === true,
            tabIndex: active === true ? 0 : -1,
            'data-active': active === true ? 'true' : undefined,
            'data-tab-id': tab.id,
            className: 'dsh-tdfi-tab',
            title: tab.absolutePath,
            onClick: activate,
            onAuxClick: (event) => {
              if (event.button === 1) {
                event.preventDefault()
                onClose(tab.id)
              }
            },
            onKeyDown: (event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              activate()
            },
          },
          React.createElement(
            'span',
            { className: 'dsh-tdfi-tab-icon' },
            React.createElement(FileTypeIcon, { path: tab.absolutePath, size: 14 }),
          ),
          React.createElement('span', { className: 'dsh-tdfi-tab-name' }, tab.fileName),
          tab.dirty === true ? React.createElement('span', { className: 'dsh-tdfi-dirty', title: t('unsaved') }) : null,
          React.createElement(
            'button',
            {
              type: 'button',
              className: 'dsh-tdfi-tab-close',
              'aria-label': t('closeTab'),
              title: t('closeTab'),
              onClick: (event) => {
                event.stopPropagation()
                onClose(tab.id)
              },
            },
            React.createElement(IconCloseOutlineRegular, { size: 12 }),
          ),
        )
      }

      function TabStrip({ tabs, activeId, onActivate, onClose, t }) {
        return React.createElement(
          'div',
          { className: 'dsh-tdfi-tabs', role: 'tablist', 'aria-label': t('tabsLabel') },
          tabs.map((tab) =>
            React.createElement(Tab, {
              key: tab.id,
              tab,
              active: tab.id === activeId,
              onActivate,
              onClose,
              t,
            }),
          ),
        )
      }

      /**
       * A card over the document body; it never stacks a second portal Modal.
       */
      function ConfirmOverlay({ confirm, t, onCancel, onDiscard, onSave, busy }) {
        if (confirm === null || confirm === undefined) return null
        const many = typeof confirm.count === 'number' && confirm.count > 1
        const title = confirm.kind === 'cancelEdit' ? t('discardEditTitle') : t('unsavedTitle')
        const body = many
          ? t('unsavedBodyMany', { count: confirm.count })
          : confirm.kind === 'cancelEdit'
            ? t('discardEditBody')
            : t('unsavedBody', { name: confirm.name ?? '' })
        const saveLabel = t('saveAndClose')
        const discardLabel = confirm.kind === 'cancelEdit' ? t('discardEdit') : t('discard')
        return React.createElement(
          'div',
          { className: 'dsh-tdfi-confirm', role: 'presentation' },
          React.createElement(
            'div',
            {
              className: 'dsh-tdfi-confirm-card',
              role: 'dialog',
              'aria-modal': 'true',
              'aria-label': title,
            },
            React.createElement('h3', { className: 'dsh-tdfi-confirm-title' }, title),
            React.createElement('p', { className: 'dsh-tdfi-confirm-body' }, body),
            React.createElement(
              'div',
              { className: 'dsh-tdfi-confirm-actions' },
              React.createElement(Button, { variant: 'ghost', size: 'sm', onClick: onCancel }, t('cancel')),
              React.createElement(
                Button,
                { variant: 'outline', size: 'sm', onClick: onDiscard, disabled: busy === true },
                discardLabel,
              ),
              onSave === undefined
                ? null
                : React.createElement(
                    Button,
                    { variant: 'primary', size: 'sm', onClick: onSave, disabled: busy === true },
                    busy === true ? t('saving') : saveLabel,
                  ),
            ),
          ),
        )
      }

      return { TabStrip, ConfirmOverlay }
    }

    module.exports = { createTabs }
    return module.exports
  },
})
