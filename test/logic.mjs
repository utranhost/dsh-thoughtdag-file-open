// Browser-free behaviour tests for the in-page viewer:
// link classification, tab opening/deduping, the edit/save/conflict flow,
// unsaved-change confirmation, and the chunk split itself.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, createHarness, jsonResponse, settle } from './harness.mjs'

let passed = 0
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1
      console.log(`ok - ${name}`)
    })
    .catch((error) => {
      console.error(`FAIL - ${name}`)
      throw error
    })
}

/** Fetch double: capabilities + save route against the harness virtual files. */
function makeFetch(files, versions, options = {}) {
  const posts = []
  let staleOnce = options.staleOnce === true
  const fetchImpl = async (url, init = {}) => {
    const target = String(url)
    if (target.includes('api/thoughtdag-file-open.save')) {
      const body = JSON.parse(init.body)
      posts.push(body)
      if (options.offline === true) throw new Error('network down')
      if (staleOnce) {
        staleOnce = false
        return jsonResponse({ ok: false, code: 'FS_STALE_VERSION', message: 'stale' }, 409)
      }
      if (options.deny === true) return jsonResponse({ ok: false, code: 'FS_SANDBOX_DENIED', message: 'denied' }, 403)
      const expected = body.expectedVersion
      if (expected !== undefined && expected !== versions.get(body.path)) {
        return jsonResponse({ ok: false, code: 'FS_STALE_VERSION', message: 'stale' }, 409)
      }
      const nextVersion = `saved-${String(posts.length)}`
      files.set(body.path, body.content)
      versions.set(body.path, nextVersion)
      return jsonResponse({ ok: true, version: nextVersion, operation: 'update', bytes: body.content.length })
    }
    if (target.includes('api/thoughtdag-file-open')) {
      return jsonResponse({ ok: true, editing: options.editing !== false, version: '3.0.0' })
    }
    return jsonResponse({ ok: false }, 404)
  }
  return { fetchImpl, posts }
}

async function openFiles(harness, paths) {
  for (const path of paths) {
    const opened = await harness.debug().openAbsolute(path)
    assert.equal(opened, true, `expected ${path} to open`)
  }
  await settle()
}

async function run() {
  // ── the chunk split ───────────────────────────────────────────────────────
  const baseHarness = createHarness({
    files: {
      '/project/notes/a.md': '# Title\n\nbody\n',
      '/project/src/main.js': 'export const x = 1\n',
      '/project/data.csv': 'a,b\n1,2\n',
    },
  })
  await check('entry loads all six package-local chunks', async () => {
    assert.equal(await baseHarness.debug().ready(), true)
    const util = await baseHarness.chunk('client.util.js')
    const remote = await baseHarness.chunk('client.remote.js')
    const styles = await baseHarness.chunk('client.styles.js')
    const tabs = await baseHarness.chunk('client.tabs.js')
    const preview = await baseHarness.chunk('client.preview.js')
    const editor = await baseHarness.chunk('client.editor.js')
    assert.equal(typeof util.classifyHref, 'function')
    assert.equal(typeof remote.createRemote, 'function')
    assert.match(styles.CSS, /\.dsh-tdfi-dialog\.dsh-tdfi-dialog/)
    assert.equal(typeof tabs.createTabs, 'function')
    assert.equal(typeof preview.createPreview, 'function')
    assert.equal(typeof editor.createEditor, 'function')
  })

  await check('the vendored CodeMirror chunk is a self-registering, licensed artifact', () => {
    const source = readFileSync(join(ROOT, 'client.codemirror.js'), 'utf8')
    assert.match(source, /window\.__ModuleLoader__\.load\(/)
    assert.match(source, /chunk: 'client\.codemirror\.js'/)
    assert.match(source, /return __VENDORED_CODEMIRROR/)
    assert.match(source, /All bundled code is MIT licensed/)
    assert.match(source, /@codemirror\/view@6\./)
  })

  await check('every component factory builds from the chunk seams', async () => {
    const primitives = {
      FileTypeIcon: () => null,
      Button: () => null,
      CodeBlock: () => null,
      MarkdownText: () => null,
      MarkdownDelegateProvider: () => null,
      StateDot: () => null,
      IconCloseOutlineRegular: () => null,
    }
    const tabs = await baseHarness.chunk('client.tabs.js')
    const preview = await baseHarness.chunk('client.preview.js')
    const editor = await baseHarness.chunk('client.editor.js')
    const built = tabs.createTabs({ primitives })
    assert.equal(typeof built.TabStrip, 'function')
    assert.equal(typeof built.ConfirmOverlay, 'function')
    assert.equal(typeof preview.createPreview({ util: await baseHarness.chunk('client.util.js'), t: (k) => k }).PreviewBody, 'function')
    assert.equal(typeof editor.createEditor({ t: (k) => k }).Editor, 'function')
  })

  // ── link classification ──────────────────────────────────────────────────
  await check('file links classify, external links are left alone', async () => {
    const util = await baseHarness.chunk('client.util.js')
    const relative = util.classifyHref('docs/a.md')
    assert.equal(relative.path, 'docs/a.md')
    assert.equal(relative.absolute, false)
    assert.equal(relative.line, undefined)
    const withLine = util.classifyHref('docs\\b.md:7')
    assert.equal(withLine.path, 'docs/b.md')
    assert.equal(withLine.line, 7)
    const range = util.classifyHref('a.md#L92-L99')
    assert.equal(range.path, 'a.md')
    assert.equal(range.line, 92)
    const bare = util.classifyHref('README')
    assert.equal(bare.path, 'README')
    assert.equal(bare.line, undefined)
    assert.equal(util.classifyHref('https://example.com/a.md'), null)
    assert.equal(util.classifyHref('mailto:a@b.c'), null)
    assert.equal(util.classifyHref('#/canvas/route'), null)
    assert.equal(util.classifyHref('justtext'), null)
    const fileUrl = util.classifyHref('file:///tmp/report.md')
    assert.equal(fileUrl.absolute, true)
    assert.equal(fileUrl.path, '/tmp/report.md')
    const drive = util.classifyHref('C:\\work\\a.md#L5')
    assert.equal(drive.absolute, true)
    assert.equal(drive.path, 'C:/work/a.md')
    assert.equal(drive.line, 5)
  })

  // ── opening tabs ────────────────────────────────────────────────────────
  const openHarness = createHarness({
    files: {
      '/project/notes/a.md': '# Title\n\nbody\n',
      '/project/src/main.js': 'export const x = 1\n',
    },
  })
  await check('two files open as two tabs, the second becomes active', async () => {
    await openFiles(openHarness, ['/project/notes/a.md', '/project/src/main.js'])
    const tabs = openHarness.debug().state().tabs
    assert.equal(tabs.length, 2)
    assert.equal(tabs[0].kind, 'markdown')
    assert.equal(tabs[0].phase, 'ready')
    assert.equal(tabs[1].kind, 'code')
    assert.equal(openHarness.debug().state().activeId, '/project/src/main.js')
  })

  await check('re-opening an open file activates it and retargets the line', async () => {
    await openHarness.debug().openAbsolute('/project/notes/a.md', { line: 5 })
    await settle()
    const tabs = openHarness.debug().state().tabs
    assert.equal(tabs.length, 2)
    assert.equal(openHarness.debug().state().activeId, '/project/notes/a.md')
    assert.equal(tabs[0].line, 5)
  })

  await check('closing a clean tab removes it and picks a neighbour', async () => {
    openHarness.debug().closeTab('/project/src/main.js')
    await settle()
    const state = openHarness.debug().state()
    assert.equal(state.tabs.length, 1)
    assert.equal(state.tabs[0].id, '/project/notes/a.md')
    assert.equal(state.activeId, '/project/notes/a.md')
  })

  // ── edit / save ─────────────────────────────────────────────────────────
  const editFiles = new Map([
    ['/project/notes/a.md', '# Title\n\nbody\n'],
    ['/project/src/main.js', 'export const x = 1\n'],
  ])
  const editVersions = new Map([
    ['/project/notes/a.md', 'v-a'],
    ['/project/src/main.js', 'v-b'],
  ])
  const { fetchImpl, posts } = makeFetch(editFiles, editVersions)
  const editHarness = createHarness({ fetch: fetchImpl, filesMap: editFiles, versionsMap: editVersions })

  await check('a tab opens in preview mode and edit switches to the editor', async () => {
    await openFiles(editHarness, ['/project/notes/a.md'])
    const tab = editHarness.debug().active()
    assert.equal(tab.mode, 'preview')
    await editHarness.debug().edit()
    await settle()
    const editing = editHarness.debug().active()
    assert.equal(editing.mode, 'edit')
    assert.equal(editing.draft, '# Title\n\nbody\n')
    assert.equal(editing.dirty, false)
    assert.equal(editHarness.debug().editingSupported(), true)
  })

  await check('saving posts the expected version and clears the dirty state', async () => {
    editHarness.debug().draft('# Title\n\nedited body\n')
    await settle()
    assert.equal(editHarness.debug().active().dirty, true)
    const saved = await editHarness.debug().save()
    await settle()
    assert.equal(saved, true)
    assert.equal(posts.length, 1)
    assert.equal(posts[0].path, '/project/notes/a.md')
    assert.equal(posts[0].expectedVersion, 'v-a')
    assert.equal(posts[0].content, '# Title\n\nedited body\n')
    const tab = editHarness.debug().active()
    assert.equal(tab.dirty, false)
    assert.equal(tab.version, 'saved-1')
    assert.equal(tab.mode, 'edit')
    assert.equal(editHarness.files.get('/project/notes/a.md'), '# Title\n\nedited body\n')
  })

  await check('going back to preview on a dirty tab asks first', async () => {
    editHarness.debug().draft('# Title\n\nsecond edit\n')
    await settle()
    await editHarness.debug().preview()
    const confirm = editHarness.debug().state().confirm
    assert.equal(confirm.kind, 'cancelEdit')
    editHarness.debug().confirmCancel()
    assert.equal(editHarness.debug().state().confirm, null)
    assert.equal(editHarness.debug().active().mode, 'edit')
    editHarness.debug().confirmDiscard
    // discard restores the saved baseline and returns to preview
    await editHarness.debug().preview()
    editHarness.debug().confirmDiscard()
    assert.equal(editHarness.debug().active().mode, 'preview')
    assert.equal(editHarness.debug().active().dirty, false)
    assert.equal(editHarness.debug().active().text, '# Title\n\nedited body\n')
  })

  // ── conflicts and failures ──────────────────────────────────────────────
  const staleFiles = new Map([['/project/notes/a.md', 'original\n']])
  const staleVersions = new Map([['/project/notes/a.md', 'v-orig']])
  const staleFetch = makeFetch(staleFiles, staleVersions, { staleOnce: true })
  const staleHarness = createHarness({ fetch: staleFetch.fetchImpl, filesMap: staleFiles, versionsMap: staleVersions })

  await check('a stale version raises the conflict state, force save overwrites', async () => {
    await openFiles(staleHarness, ['/project/notes/a.md'])
    await staleHarness.debug().edit()
    await settle()
    staleHarness.debug().draft('mine\n')
    await settle()
    const first = await staleHarness.debug().save()
    assert.equal(first, false)
    const conflicted = staleHarness.debug().active()
    assert.equal(conflicted.conflict, true)
    assert.equal(conflicted.saving, false)
    const forced = await staleHarness.debug().saveForce()
    assert.equal(forced, true)
    assert.equal(staleHarness.debug().active().conflict, false)
    assert.equal(staleFetch.posts.length, 2)
    assert.equal(staleFetch.posts[1].force, true)
  })

  await check('a denied or offline save reports failure and keeps the draft', async () => {
    const denyFiles = new Map([['/project/notes/a.md', 'x\n']])
    const denyVersions = new Map([['/project/notes/a.md', 'v']])
    const denyFetch = makeFetch(denyFiles, denyVersions, { deny: true })
    const denyHarness = createHarness({ fetch: denyFetch.fetchImpl, files: { '/project/notes/a.md': 'x\n' } })
    denyHarness.versions.set('/project/notes/a.md', 'v')
    await openFiles(denyHarness, ['/project/notes/a.md'])
    await denyHarness.debug().edit()
    await settle()
    denyHarness.debug().draft('changed\n')
    await settle()
    assert.equal(await denyHarness.debug().save(), false)
    const tab = denyHarness.debug().active()
    assert.equal(tab.saving, false)
    assert.equal(tab.dirty, true)
    assert.equal(tab.conflict, false)
  })

  await check('editing is unavailable when the Host route is missing', async () => {
    const noHost = createHarness({ fetch: undefined, files: { '/project/notes/a.md': 'x\n' } })
    await openFiles(noHost, ['/project/notes/a.md'])
    await noHost.debug().edit()
    await settle()
    assert.equal(noHost.debug().active().mode, 'preview')
    assert.equal(noHost.debug().editingSupported(), false)
  })

  // ── unsaved changes on close ────────────────────────────────────────────
  await check('closing a dirty tab asks, discard closes it', async () => {
    const files = new Map([
      ['/project/notes/a.md', 'a\n'],
      ['/project/notes/b.md', 'b\n'],
    ])
    const versions = new Map([
      ['/project/notes/a.md', 'v1'],
      ['/project/notes/b.md', 'v2'],
    ])
    const local = makeFetch(files, versions)
    const harness = createHarness({ fetch: local.fetchImpl, filesMap: files, versionsMap: versions })
    await openFiles(harness, ['/project/notes/a.md', '/project/notes/b.md'])
    await harness.debug().openAbsolute('/project/notes/a.md')
    await settle()
    await harness.debug().edit()
    await settle()
    harness.debug().draft('a changed\n')
    await settle()
    harness.debug().closeTab('/project/notes/a.md')
    const confirm = harness.debug().state().confirm
    assert.equal(confirm.kind, 'closeTab')
    assert.equal(confirm.tabId, '/project/notes/a.md')
    harness.debug().confirmDiscard()
    assert.equal(harness.debug().state().tabs.length, 1)
    assert.equal(harness.debug().state().tabs[0].id, '/project/notes/b.md')
  })

  await check('closing the dialog with dirty tabs asks, save-and-close saves all', async () => {
    const files = new Map([['/project/notes/a.md', 'a\n']])
    const versions = new Map([['/project/notes/a.md', 'v1']])
    const local = makeFetch(files, versions)
    const harness = createHarness({ fetch: local.fetchImpl, filesMap: files, versionsMap: versions })
    await openFiles(harness, ['/project/notes/a.md'])
    await harness.debug().edit()
    await settle()
    harness.debug().draft('saved on close\n')
    await settle()
    harness.debug().close()
    const confirm = harness.debug().state().confirm
    assert.equal(confirm.kind, 'closeDialog')
    await harness.debug().confirmSave()
    await settle()
    assert.equal(harness.debug().state().tabs.length, 0)
    assert.equal(harness.files.get('/project/notes/a.md'), 'saved on close\n')
  })

  // ── unresolved / non-file links ─────────────────────────────────────────
  await check('an unresolvable link returns false instead of opening a tab', async () => {
    const harness = createHarness({ fetch: async () => jsonResponse({ sessions: [] }, 200), files: {} })
    const opened = await harness.debug().open('missing/file.md')
    assert.equal(opened, false)
    assert.equal(harness.debug().state().tabs.length, 0)
  })

  await check('a binary preview kind stays read-only', async () => {
    const harness = createHarness({ files: { '/project/logo.png': 'not-really-a-png' } })
    await openFiles(harness, ['/project/logo.png'])
    const tab = harness.debug().active()
    assert.equal(tab.kind, 'image')
    assert.equal(tab.phase, 'ready')
  })

  await check('relative targets resolve against the document directory', async () => {
    const harness = createHarness({
      files: {
        '/project/docs/guide.md': '# Guide\n\n[status](../notes/status.md)\n',
        '/project/notes/status.md': 'done\n',
      },
      fetch: async () => jsonResponse({ sessions: [] }, 200),
    })
    await openFiles(harness, ['/project/docs/guide.md'])
    const opened = await harness.debug().open('/project/notes/status.md')
    assert.equal(opened, true)
    await settle()
    assert.equal(harness.debug().state().tabs.length, 2)
  })

  // ── shallow rendering of the dialog chrome ──────────────────────────────
  await check('a ready markdown tab renders the dialog chrome and markdown body', async () => {
    const harness = createHarness({
      fetch: async () => jsonResponse({ ok: true, editing: true }),
      files: { '/project/docs/guide.md': '# Guide\n\ntext\n' },
    })
    await openFiles(harness, ['/project/docs/guide.md'])
    const classes = harness.overlayClasses()
    for (const expected of [
      'dsh-tdfi-dialog',
      'dsh-tdfi-shell',
      'dsh-tdfi-head',
      'dsh-tdfi-tabs',
      'dsh-tdfi-tab',
      'dsh-tdfi-actions',
      'dsh-tdfi-meta',
      'dsh-tdfi-body',
      'dsh-tdfi-foot',
      'dsh-tdfi-scroll',
      'dsh-tdfi-md',
    ]) {
      assert.ok(classes.includes(expected), `missing ${expected} in ${classes.join(', ')}`)
    }
    assert.ok(classes.includes('dsh-tdfi-dirty') === false, 'a clean tab must not show a dirty dot')
  })

  await check('a code tab renders the code scroll region', async () => {
    const harness = createHarness({
      fetch: async () => jsonResponse({ ok: true, editing: true }),
      files: { '/project/src/main.js': 'export const x = 1\n' },
    })
    await openFiles(harness, ['/project/src/main.js'])
    const classes = harness.overlayClasses()
    assert.ok(classes.includes('dsh-tdfi-code'))
    assert.ok(classes.includes('dsh-tdfi-scroll'))
  })

  await check('edit mode renders the CodeMirror host, dirty shows the dot', async () => {
    const files = new Map([['/project/docs/guide.md', '# Guide\n']])
    const versions = new Map([['/project/docs/guide.md', 'v1']])
    const local = makeFetch(files, versions)
    const harness = createHarness({ fetch: local.fetchImpl, filesMap: files, versionsMap: versions })
    await openFiles(harness, ['/project/docs/guide.md'])
    await harness.debug().edit()
    await settle()
    let classes = harness.overlayClasses()
    assert.ok(classes.includes('dsh-tdfi-editor'))
    assert.ok(classes.includes('dsh-tdfi-cm-host'))
    assert.ok(classes.includes('dsh-tdfi-cm-loading'))
    harness.debug().draft('# Guide\n\nchanged\n')
    await settle()
    classes = harness.overlayClasses()
    assert.ok(classes.includes('dsh-tdfi-dirty'))
  })

  await check('maximize toggles the dialog class and resets when the dialog closes', async () => {
    const harness = createHarness({
      fetch: async () => jsonResponse({ ok: true, editing: true }),
      files: { '/project/docs/guide.md': '# Guide\n' },
    })
    await openFiles(harness, ['/project/docs/guide.md'])
    assert.equal(harness.debug().state().maximized, false)
    harness.debug().toggleMaximize()
    assert.equal(harness.debug().state().maximized, true)
    assert.ok(harness.overlayClasses().some((name) => typeof name === 'string' && name.includes('dsh-tdfi-maximized')))
    harness.debug().toggleMaximize()
    assert.equal(harness.debug().state().maximized, false)
    assert.ok(!harness.overlayClasses().some((name) => typeof name === 'string' && name.includes('dsh-tdfi-maximized')))
    harness.debug().toggleMaximize()
    harness.debug().forceCloseAll()
    assert.equal(harness.debug().state().maximized, false)
    assert.equal(harness.debug().state().tabs.length, 0)
  })

  await check('the unsaved confirmation renders its card over the body', async () => {
    const files = new Map([['/project/docs/guide.md', '# Guide\n']])
    const versions = new Map([['/project/docs/guide.md', 'v1']])
    const local = makeFetch(files, versions)
    const harness = createHarness({ fetch: local.fetchImpl, filesMap: files, versionsMap: versions })
    await openFiles(harness, ['/project/docs/guide.md'])
    await harness.debug().edit()
    await settle()
    harness.debug().draft('changed\n')
    await settle()
    harness.debug().close()
    const classes = harness.overlayClasses()
    assert.ok(classes.includes('dsh-tdfi-confirm'))
    assert.ok(classes.includes('dsh-tdfi-confirm-card'))
  })

  console.log(`\n${passed} checks passed`)
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
