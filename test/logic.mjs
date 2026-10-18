// Viewer + resolution checks: file kinds render in the in-page modal state,
// resolution prefers the canvas's own project folder, failures report, and
// ordinary HTTP(S) links are never intercepted.
import { makeSandbox, fakeWorkspaceFiles, fakeOfficeToPdf, assert } from './harness.mjs'

const SESSIONS = { current: 'session-chat', byId: { 'session-chat': { cwd: '/workspace/proj' } } }

// ── Markdown opens in the modal, never by switching the main panel ───────
{
  const workspaceFiles = fakeWorkspaceFiles({
    '/workspace/proj/docs/product/status.md': '# 系统当前状态\n\n正文内容。',
  })
  const harness = makeSandbox({ sessions: SESSIONS, workspaceFiles })
  const opened = await harness.api.open('docs/product/status.md')
  assert(opened === true, 'relative Markdown link opens')
  const state = harness.api.state()
  assert(state?.phase === 'ready' && state.kind === 'markdown', 'Markdown renders through the Markdown viewer')
  assert(state.text.includes('系统当前状态'), 'Markdown content was read')
  assert(state.fileName === 'status.md' && state.absolutePath === '/workspace/proj/docs/product/status.md', 'modal is titled and located from the resolved file')
  assert(!harness.ops.panels.some((entry) => entry[0] === 'panel'), 'the main panel is NOT switched (no page jump)')
  assert(harness.ops.opened.length === 0, 'no document-window tab is opened')
  harness.api.close()
}

// ── Code files render as highlighted code ────────────────────────────────
{
  const workspaceFiles = fakeWorkspaceFiles({ '/workspace/proj/src/main.py': 'print("hi")\n' })
  const harness = makeSandbox({ sessions: SESSIONS, workspaceFiles })
  await harness.api.open('src/main.py')
  const state = harness.api.state()
  assert(state?.kind === 'code', '.py renders through the code viewer')
  assert(state.language === 'python', 'language is derived from the extension (python)')
  assert(state.text.includes('print("hi")'), 'code source was read')
}

// ── Images, PDF and HTML read bytes into blob URLs ───────────────────────
for (const [href, kind, file] of [
  ['file:///workspace/proj/img/logo.png', 'image', '/workspace/proj/img/logo.png'],
  ['file:///workspace/proj/docs/spec.pdf', 'pdf', '/workspace/proj/docs/spec.pdf'],
  ['file:///workspace/proj/demo/index.html', 'html', '/workspace/proj/demo/index.html'],
]) {
  const workspaceFiles = fakeWorkspaceFiles({ [file]: 'binary-bytes' })
  const harness = makeSandbox({ sessions: SESSIONS, workspaceFiles })
  await harness.api.open(href)
  const state = harness.api.state()
  assert(state?.kind === kind && state.url === 'blob:mock-url', `${kind} previews from a blob URL`)
  assert(harness.ops.panels.length === 0, `${kind} preview stays on the page`)
}

// ── Office documents convert to PDF in-page ──────────────────────────────
{
  const workspaceFiles = fakeWorkspaceFiles({ '/workspace/proj/docs/report.docx': '' })
  const harness = makeSandbox({ sessions: SESSIONS, workspaceFiles, officeToPdf: fakeOfficeToPdf() })
  await harness.api.open('file:///workspace/proj/docs/report.docx')
  const state = harness.api.state()
  assert(state?.kind === 'pdf' && state.origin === 'office', 'a .docx renders through the host Office→PDF conversion')
}

// ── Without the conversion service, Office falls back to the window button ─
{
  const workspaceFiles = fakeWorkspaceFiles({ '/workspace/proj/docs/report.docx': '' })
  const harness = makeSandbox({ sessions: SESSIONS, workspaceFiles })
  await harness.api.open('file:///workspace/proj/docs/report.docx')
  const state = harness.api.state()
  assert(state?.kind === 'unsupported' && state.reason === 'office', 'Office without a converter reports the window fallback')
}

// ── Binary / unreadable files report instead of rendering garbage ───────
{
  const workspaceFiles = fakeWorkspaceFiles({ '/workspace/proj/blob.bin': 'x' }, { binary: ['/workspace/proj/blob.bin'] })
  const harness = makeSandbox({ sessions: SESSIONS, workspaceFiles })
  await harness.api.open('blob.bin')
  const state = harness.api.state()
  assert(state?.kind === 'unsupported' && state.reason === 'binary', 'a binary file reports that it cannot preview')
}

// ── Large text is truncated with a note ─────────────────────────────────
{
  const big = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join('\n')
  const workspaceFiles = fakeWorkspaceFiles({ '/workspace/proj/big.log': big }, { paged: true, pageLines: 2 })
  const harness = makeSandbox({ sessions: SESSIONS, workspaceFiles })
  await harness.api.open('big.log')
  const state = harness.api.state()
  assert(state?.kind === 'code' && state.truncated === true, 'a large text file is truncated and flagged')
}

// ── HTTP(S) links are left completely alone ──────────────────────────────
{
  const harness = makeSandbox({ sessions: SESSIONS, workspaceFiles: fakeWorkspaceFiles({}) })
  const opened = await harness.api.open('https://example.com/page?a=1')
  assert(opened === false && harness.api.state() === null, 'an HTTP(S) link never opens the viewer')
  assert(harness.ops.windows.length === 0, 'an HTTP(S) link never opens a window from the plugin')
}

// ── Unknown extension with text content still previews ──────────────────
{
  const workspaceFiles = fakeWorkspaceFiles({ '/workspace/proj/deploy.weird': 'key: value\n' })
  const harness = makeSandbox({ sessions: SESSIONS, workspaceFiles })
  await harness.api.open('deploy.weird')
  const state = harness.api.state()
  assert(state?.kind === 'code' && state.text.includes('key: value'), 'unknown extensions with text content preview as text')
}

// ── The canvas's own project folder outranks an outer session cwd ───────
{
  const workspaceFiles = fakeWorkspaceFiles({
    '/workspace/docs/spec.md': 'outer',
    '/srv/canvas-project/docs/spec.md': 'inner',
  })
  const harness = makeSandbox({
    sessions: { current: 'session-chat', byId: { 'session-chat': { cwd: '/workspace' } } },
    workspaceFiles,
    indexedDB: {
      databases: async () => [{ name: 'keyval-store', version: 1 }],
      open: () => {
        const request = { result: null, error: null, transaction: { abort: () => {} } }
        setTimeout(() => request.onsuccess?.(), 0)
        request.result = {
          objectStoreNames: { contains: () => true },
          transaction: () => ({
            objectStore: () => ({
              getAll: () => {
                const all = {
                  result: [{ state: { projects: [{ id: 'active', agentCwd: '/srv/canvas-project' }], activeId: 'active' }, version: 1 }],
                }
                setTimeout(() => all.onsuccess?.(), 0)
                return all
              },
            }),
          }),
          close: () => {},
        }
        return request
      },
    },
  })
  await harness.api.open('docs/spec.md')
  const state = harness.api.state()
  assert(state.absolutePath === '/srv/canvas-project/docs/spec.md', 'the canvas project folder wins over an outer session cwd')
}

// ── Session cwds reported by the ThoughtDAG bridge participate ──────────
{
  const workspaceFiles = fakeWorkspaceFiles({ '/workspace/archived/docs/old.md': 'old docs' })
  const harness = makeSandbox({
    sessions: SESSIONS,
    workspaceFiles,
    fetch: async () => ({ ok: true, json: async () => ({ sessions: [{ id: 'session-old', cwd: '/workspace/archived' }] }) }),
  })
  await harness.api.open('docs/old.md')
  const state = harness.api.state()
  assert(state.absolutePath === '/workspace/archived/docs/old.md', 'an archived session cwd from the bridge resolves the link')
}

// ── line targets: ':48' and '#L92' both open the file at that line ──────
{
  const workspaceFiles = fakeWorkspaceFiles({ '/workspace/proj/packages/x/ctp_pipeline.dos': 'line1\nline2\n' })
  const harness = makeSandbox({ sessions: SESSIONS, workspaceFiles })
  const opened = await harness.api.open('packages/x/ctp_pipeline.dos:48')
  const state = harness.api.state()
  assert(opened === true, 'a trailing :48 line target opens the file')
  assert(state.absolutePath === '/workspace/proj/packages/x/ctp_pipeline.dos', 'the :48 suffix is stripped from the resolved path')
  assert(state.line === 48, 'the :48 suffix becomes the line target')
  assert(state.kind === 'code', 'the .dos file previews as code')
}
{
  const workspaceFiles = fakeWorkspaceFiles({ '/workspace/proj/packages/x/ctp_pipeline.dos': 'line1\n' })
  const harness = makeSandbox({ sessions: SESSIONS, workspaceFiles })
  await harness.api.open('packages/x/ctp_pipeline.dos#L92')
  assert(harness.api.state().line === 92, 'a #L92 fragment becomes the line target')
}
{
  const workspaceFiles = fakeWorkspaceFiles({ '/workspace/proj/packages/x/ctp_pipeline.dos': 'line1\n' })
  const harness = makeSandbox({ sessions: SESSIONS, workspaceFiles })
  await harness.api.open('packages/x/ctp_pipeline.dos#L10-L20')
  assert(harness.api.state().line === 10, 'a #L10-L20 range jumps to its first line')
}
{
  const workspaceFiles = fakeWorkspaceFiles({ '/workspace/proj/src/main.py': 'print(1)\n' })
  const harness = makeSandbox({ sessions: SESSIONS, workspaceFiles })
  await harness.api.open('src/main.py:12:5')
  const state = harness.api.state()
  assert(state.line === 12 && state.absolutePath === '/workspace/proj/src/main.py', 'a :line:column suffix is understood too')
}

// ── Windows path spellings ──────────────────────────────────────────────
{
  const workspaceFiles = fakeWorkspaceFiles({ 'C:/proj/docs/spec.md': 'win docs' })
  const harness = makeSandbox({
    sessions: { current: 'session-win', byId: { 'session-win': { cwd: 'C:\\proj' } } },
    workspaceFiles,
  })
  const opened = await harness.api.open('docs\\spec.md:7')
  const state = harness.api.state()
  assert(opened === true && state !== null, 'a Windows workspace resolves a backslash relative link')
  assert(state.absolutePath === 'C:/proj/docs/spec.md', 'Windows relative resolution joins with forward slashes')
  assert(state.line === 7, 'the :line suffix works on a Windows path')
}
{
  const workspaceFiles = fakeWorkspaceFiles({ 'C:/data/notes/todo.md': 'todo' })
  const harness = makeSandbox({ sessions: SESSIONS, workspaceFiles })
  await harness.api.open('file:///C:/data/notes/todo.md#L3')
  const state = harness.api.state()
  assert(state.absolutePath === 'C:/data/notes/todo.md', 'a Windows file:// URL resolves to its drive path')
  assert(state.line === 3, 'a #L fragment after a Windows file URL becomes the line target')
}
{
  const workspaceFiles = fakeWorkspaceFiles({ 'C:/data/notes/todo.md': 'todo' })
  const harness = makeSandbox({ sessions: SESSIONS, workspaceFiles })
  await harness.api.open('C:\\data\\notes\\todo.md:3')
  const state = harness.api.state()
  assert(state.absolutePath === 'C:/data/notes/todo.md', 'a bare Windows drive link is not mistaken for a URL scheme')
  assert(state.line === 3, 'a bare Windows drive link keeps its line target')
}
{
  const workspaceFiles = fakeWorkspaceFiles({ '//server/share/doc.md': 'unc' })
  const harness = makeSandbox({ sessions: SESSIONS, workspaceFiles })
  await harness.api.open('file://server/share/doc.md')
  const state = harness.api.state()
  assert(state.absolutePath === '//server/share/doc.md', 'a UNC file:// URL resolves')
}
{
  const workspaceFiles = fakeWorkspaceFiles({ 'D:/canvas/notes/a.md': 'proj' })
  const harness = makeSandbox({
    sessions: { current: 'session-chat', byId: { 'session-chat': { cwd: 'C:\\proj' } } },
    workspaceFiles,
    indexedDB: {
      databases: async () => [{ name: 'keyval-store', version: 1 }],
      open: () => {
        const request = { result: null, error: null, transaction: { abort: () => {} } }
        setTimeout(() => request.onsuccess?.(), 0)
        request.result = {
          objectStoreNames: { contains: () => true },
          transaction: () => ({
            objectStore: () => ({
              getAll: () => {
                const all = {
                  result: [{ state: { projects: [{ id: 'active', agentCwd: 'D:\\canvas' }], activeId: 'active' }, version: 1 }],
                }
                setTimeout(() => all.onsuccess?.(), 0)
                return all
              },
            }),
          }),
          close: () => {},
        }
        return request
      },
    },
  })
  await harness.api.open('notes/a.md')
  assert(harness.api.state().absolutePath === 'D:/canvas/notes/a.md', 'a Windows canvas project dir participates in resolution')
}
{
  // macOS/Unix stays untouched: POSIX drive-less absolute and relative paths.
  const workspaceFiles = fakeWorkspaceFiles({ '/Users/me/proj/docs/a.md': 'mac' })
  const harness = makeSandbox({
    sessions: { current: 'session-mac', byId: { 'session-mac': { cwd: '/Users/me/proj' } } },
    workspaceFiles,
  })
  await harness.api.open('docs/a.md#L5')
  const state = harness.api.state()
  assert(state.absolutePath === '/Users/me/proj/docs/a.md' && state.line === 5, 'POSIX (macOS/Linux) paths still resolve')
}

// ── Closing releases the viewer ─────────────────────────────────────────
{
  const workspaceFiles = fakeWorkspaceFiles({ '/workspace/proj/x.png': 'png' })
  const harness = makeSandbox({ sessions: SESSIONS, workspaceFiles })
  await harness.api.open('file:///workspace/proj/x.png')
  assert(harness.api.state() !== null, 'image open before close')
  harness.api.close()
  assert(harness.api.state() === null, 'close dismisses the modal')
}

console.log('\nall viewer/resolution checks passed')
