// Click-bridge checks over a fake ThoughtDAG iframe: file links open the
// in-page modal, while HTTP(S) links, hash routes, mail links and non-primary
// buttons are left completely alone.
import { makeSandbox, fakeWorkspaceFiles, assert, waiting } from './harness.mjs'

const SESSIONS = { current: 'session-chat', byId: { 'session-chat': { cwd: '/workspace/proj' } } }

function makeClickHarness(options = {}) {
  const docListeners = []
  const fakeDocument = {
    addEventListener(type, listener) {
      if (type === 'click') docListeners.push(listener)
    },
    removeEventListener() {},
  }
  const frame = {
    dataset: { src: '/thoughtdag/' },
    getAttribute: () => null,
    contentDocument: fakeDocument,
    addEventListener() {},
    removeEventListener() {},
  }
  const harness = makeSandbox({
    sessions: SESSIONS,
    workspaceFiles: options.workspaceFiles ?? fakeWorkspaceFiles({ '/workspace/proj/docs/product/status.md': '# status\n' }),
    document: {
      querySelector: (selector) => (selector === '[data-dsh-thoughtdag] iframe' ? frame : null),
      querySelectorAll: (selector) => (selector === '[data-dsh-thoughtdag] iframe' ? [frame] : []),
    },
  })

  const anchor = (href, attributes = {}) => {
    const element = {
      nodeType: 1,
      getAttribute(name) {
        if (name === 'href') return href
        return attributes[name] ?? null
      },
      closest(selector) {
        return selector === 'a[href]' ? element : null
      },
    }
    return element
  }

  const click = (href, attributes = {}, overrides = {}) => {
    const event = {
      defaultPrevented: false,
      button: 0,
      target: anchor(href, attributes),
      prevented: false,
      stopped: false,
      preventDefault() {
        this.prevented = true
        this.defaultPrevented = true
      },
      stopPropagation() {
        this.stopped = true
      },
      ...overrides,
    }
    for (const listener of docListeners) listener(event)
    return event
  }

  return { harness, click, docListeners }
}

// ── a file link in the canvas opens the in-page modal ───────────────────
{
  const { harness, click, docListeners } = makeClickHarness()
  assert(docListeners.length === 1, 'one capture click listener is attached to the canvas iframe document')
  const event = click('docs/product/status.md')
  assert(event.prevented === true && event.stopped === true, 'the file-link click is intercepted (canvas never navigates)')
  await waiting(() => harness.api.state()?.phase === 'ready', 'the modal content to load')
  assert(harness.api.state().kind === 'markdown', 'the click opened the Markdown modal')
  assert(harness.ops.panels.length === 0, 'the click did not switch the main panel')
}

// ── a ':line' file link is intercepted too ──────────────────────────────
{
  const workspaceFiles = fakeWorkspaceFiles({ '/workspace/proj/packages/x/ctp_pipeline.dos': 'a\nb\n' })
  const { harness, click } = makeClickHarness({ workspaceFiles })
  const event = click('packages/x/ctp_pipeline.dos:48')
  assert(event.prevented === true, 'a :48 file link is intercepted (never leaves the canvas)')
  await waiting(() => harness.api.state()?.phase === 'ready', 'the modal content to load')
  assert(harness.api.state().line === 48 && harness.api.state().kind === 'code', 'the :48 link opens the code modal at line 48')
}
// ── HTTP(S) links keep their native behaviour ───────────────────────────
{
  const { harness, click } = makeClickHarness()
  const event = click('https://example.com/page')
  assert(event.prevented === false && event.stopped === false, 'an HTTP(S) link is not intercepted')
  assert(harness.api.state() === null, 'an HTTP(S) link opens no modal')
  assert(harness.ops.windows.length === 0, 'an HTTP(S) link is not redirected by the plugin')
}

// ── in-app hash routes are untouched ────────────────────────────────────
{
  const { harness, click } = makeClickHarness()
  const event = click('#/canvas/node-1')
  assert(event.prevented === false && harness.api.state() === null, 'a hash route is untouched')
}

// ── extension-less routes are untouched ─────────────────────────────────
{
  const { harness, click } = makeClickHarness()
  const event = click('settings')
  assert(event.prevented === false && harness.api.state() === null, 'an extension-less route is untouched')
}

// ── mailto and other schemes are untouched ──────────────────────────────
{
  const { harness, click } = makeClickHarness()
  const event = click('mailto:someone@example.com')
  assert(event.prevented === false && harness.api.state() === null, 'mailto is untouched')
}

// ── extension-less file names that are plainly files are taken over ─────
{
  const { harness, click } = makeClickHarness({ workspaceFiles: fakeWorkspaceFiles({}) })
  const event = click('Dockerfile')
  assert(event.prevented === true, 'a bare Dockerfile link is intercepted')
  await waiting(() => true, 'noop').catch(() => {})
  assert(harness.api.state() === null, 'an unresolvable file leaves no stale modal')
}

// ── non-primary buttons are untouched ───────────────────────────────────
{
  const { harness, click } = makeClickHarness()
  const event = click('docs/product/status.md', {}, { button: 1 })
  assert(event.prevented === false && harness.api.state() === null, 'a middle-click is untouched')
}

// ── an already-handled click is untouched ───────────────────────────────
{
  const { harness, click } = makeClickHarness()
  const event = click('docs/product/status.md', {}, { defaultPrevented: true })
  assert(event.prevented === false && harness.api.state() === null, 'an already-prevented click is untouched')
}

console.log('\nall click-bridge checks passed')
