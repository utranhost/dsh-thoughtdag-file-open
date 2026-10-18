// Browser-free tests for the Host half's authenticated save route.
import assert from 'node:assert/strict'
import { apply, saveFile, CAPABILITIES_ROUTE, SAVE_ROUTE, statusForCode } from '../host.js'

let passed = 0
async function check(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`ok - ${name}`)
  } catch (error) {
    console.error(`FAIL - ${name}`)
    throw error
  }
}

function makeContext(options = {}) {
  const routes = new Map()
  const writes = []
  const policies = []
  const files = new Map(Object.entries(options.files ?? {}))
  const versions = new Map(Object.entries(options.versions ?? {}))
  const directories = new Set(options.directories ?? [])
  const disposers = []
  const ctx = {
    effect(fn) {
      const dispose = fn()
      disposers.push(dispose)
      return dispose
    },
    connection: {
      fetch: {
        register(route) {
          routes.set(route.path, route)
          return () => routes.delete(route.path)
        },
      },
    },
    fs: {
      async resolve(path) {
        return { targetKey: path, displayPath: path }
      },
      async stat(target) {
        if (directories.has(target.displayPath)) return { version: 'dir', type: 'directory' }
        if (!files.has(target.displayPath)) return undefined
        return { version: versions.get(target.displayPath), type: 'file', size: files.get(target.displayPath).length }
      },
      async writeText(target, content, expected, signal, policy) {
        writes.push({ path: target.displayPath, content, expected, policy })
        if (options.failWith !== undefined) throw Object.assign(new Error(options.failMessage ?? 'failed'), { code: options.failWith })
        if (expected?.kind === 'replaceIfVersion' && expected.version !== versions.get(target.displayPath)) {
          throw Object.assign(new Error('stale'), { code: 'FS_STALE_VERSION' })
        }
        files.set(target.displayPath, content)
        const version = `written-${String(writes.length)}`
        versions.set(target.displayPath, version)
        return { operation: 'update', version, before: content, after: content }
      },
    },
    sessions: {
      get(id) {
        return options.liveSessionId === id ? { id } : undefined
      },
    },
    sandboxPolicy: {
      resolve(request = {}) {
        policies.push(request)
        return { mode: 'danger-full-access', workspaceRoot: '/' }
      },
    },
  }
  return { ctx, routes, writes, policies, files, versions }
}

function postRequest(body) {
  return new Request(`http://127.0.0.1:3080${SAVE_ROUTE}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function run() {
  await check('apply registers the capability and save routes in the auth fence', () => {
    const { ctx, routes } = makeContext()
    apply(ctx)
    const capabilities = routes.get(CAPABILITIES_ROUTE)
    const save = routes.get(SAVE_ROUTE)
    assert.ok(capabilities, 'capabilities route missing')
    assert.ok(save, 'save route missing')
    assert.deepEqual(capabilities.methods, ['GET'])
    assert.deepEqual(save.methods, ['POST'])
    assert.equal(save.requestBody, 'buffered')
  })

  await check('the capability route reports editing support', async () => {
    const { ctx, routes } = makeContext()
    apply(ctx)
    const response = await routes.get(CAPABILITIES_ROUTE).fetch(
      new Request(`http://127.0.0.1:3080${CAPABILITIES_ROUTE}`),
    )
    const body = await response.json()
    assert.equal(response.status, 200)
    assert.equal(body.ok, true)
    assert.equal(body.editing, true)
    assert.equal(typeof body.maxContentBytes, 'number')
  })

  await check('a save writes the full document with a version guard', async () => {
    const { ctx, writes, policies } = makeContext({
      files: { '/project/notes/a.md': 'old\n' },
      versions: { '/project/notes/a.md': 'v1' },
    })
    const response = await saveFile(ctx, postRequest({
      path: '/project/notes/a.md',
      content: 'new\n',
      expectedVersion: 'v1',
      sessionId: 'session-a',
    }))
    const body = await response.json()
    assert.equal(response.status, 200)
    assert.equal(body.ok, true)
    assert.equal(body.version, 'written-1')
    assert.equal(body.bytes, 4)
    assert.equal(writes.length, 1)
    assert.equal(writes[0].content, 'new\n')
    assert.deepEqual(writes[0].expected, { kind: 'replaceIfVersion', version: 'v1' })
    assert.equal(policies.length, 1)
    assert.deepEqual(policies[0], {})
  })

  await check('force omits the version guard', async () => {
    const { ctx, writes } = makeContext({
      files: { '/project/notes/a.md': 'old\n' },
      versions: { '/project/notes/a.md': 'v1' },
    })
    const response = await saveFile(ctx, postRequest({
      path: '/project/notes/a.md',
      content: 'forced\n',
      expectedVersion: 'stale',
      force: true,
    }))
    assert.equal(response.status, 200)
    assert.equal(writes[0].expected, undefined)
  })

  await check('a live session supplies its own sandbox policy', async () => {
    const { ctx, policies } = makeContext({
      files: { '/project/notes/a.md': 'old\n' },
      versions: { '/project/notes/a.md': 'v1' },
      liveSessionId: 'session-live',
    })
    await saveFile(ctx, postRequest({
      path: '/project/notes/a.md',
      content: 'new\n',
      expectedVersion: 'v1',
      sessionId: 'session-live',
    }))
    assert.equal(policies.length, 1)
    assert.equal(policies[0].session.id, 'session-live')
  })

  await check('a stale version answers 409 with the provider code', async () => {
    const { ctx } = makeContext({
      files: { '/project/notes/a.md': 'old\n' },
      versions: { '/project/notes/a.md': 'v2' },
    })
    const response = await saveFile(ctx, postRequest({
      path: '/project/notes/a.md',
      content: 'new\n',
      expectedVersion: 'v1',
    }))
    const body = await response.json()
    assert.equal(response.status, 409)
    assert.equal(body.ok, false)
    assert.equal(body.code, 'FS_STALE_VERSION')
  })

  await check('relative, missing, non-file and oversized requests are refused', async () => {
    const { ctx, routes } = makeContext({ files: {}, directories: ['/project/dir'] })
    apply(ctx)
    const save = routes.get(SAVE_ROUTE)
    const relative = await saveFile(ctx, postRequest({ path: 'notes/a.md', content: 'x' }))
    assert.equal(relative.status, 400)
    const missing = await saveFile(ctx, postRequest({ path: '/project/missing.md', content: 'x' }))
    assert.equal(missing.status, 404)
    const notFile = await saveFile(ctx, postRequest({ path: '/project/dir', content: 'x' }))
    assert.equal(notFile.status, 409)
    const badJson = await save.fetch(new Request(`http://127.0.0.1:3080${SAVE_ROUTE}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    }))
    assert.equal(badJson.status, 400)
    const tooLarge = await saveFile(ctx, postRequest({ path: '/project/pad.md', content: 'x'.repeat(9 * 1024 * 1024) }))
    assert.equal(tooLarge.status, 413)
  })

  await check('provider error codes map onto HTTP statuses', () => {
    assert.equal(statusForCode('FS_STALE_VERSION'), 409)
    assert.equal(statusForCode('FS_SANDBOX_DENIED'), 403)
    assert.equal(statusForCode('FS_NOT_FOUND'), 404)
    assert.equal(statusForCode('FS_TOO_LARGE'), 413)
    assert.equal(statusForCode('SOMETHING_ELSE'), 500)
  })

  console.log(`\n${passed} checks passed`)
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
