/**
 * Host half of @local/thoughtdag-file-open.
 *
 * The viewer itself is a Client plugin: it intercepts file links inside the
 * ThoughtDAG canvas iframe and renders them in an in-page, tabbed dialog. This
 * Host half adds the one capability the browser cannot perform under DSH's
 * own rules — saving an edited file through the composed filesystem provider,
 * inside Connection's browser-authentication fence.
 *
 * Two authenticated exact routes are registered on `/api`:
 *
 *   GET  /api/thoughtdag-file-open   capability probe (module id, version)
 *   POST /api/thoughtdag-file-open.save
 *        body: { path, content, expectedVersion?, force?, sessionId? }
 *        200:  { ok: true, version, operation, bytes }
 *        4xx:  { ok: false, code, message }
 *
 * The write goes through `ctx.fs.writeText`, so it is atomic, returns the new
 * file version, and honors the sandbox policy: the route resolves the calling
 * Session's policy when it can (the operator configured that mode for that
 * session) and otherwise the deployment default. A stale `expectedVersion`
 * fails with 409 and `FS_STALE_VERSION`, which the UI turns into a conflict
 * banner instead of silently overwriting another writer.
 *
 * There is no user-approval prompt here on purpose: this route is only
 * reachable by the already-authenticated operator's browser, the operator
 * pressed a visible Save button, and the target must be an existing regular
 * file that the viewer already displayed.
 */

/** Authenticated capability probe. */
export const CAPABILITIES_ROUTE = '/api/thoughtdag-file-open'
/** Authenticated JSON save route. */
export const SAVE_ROUTE = '/api/thoughtdag-file-open.save'
/** One save request's content cap; larger buffers are refused, never truncated. */
export const MAX_CONTENT_BYTES = 8 * 1024 * 1024

/** Stable plugin name (matches the Loader row and the Client module id). */
export const name = '@local/thoughtdag-file-open'
/** Host services this plugin cannot work without. */
export const inject = ['connection', 'fs', 'sessions', 'sandboxPolicy']

const VERSION = '3.0.0'

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}

function failure(status, code, message) {
  return jsonResponse({ ok: false, code, message }, status)
}

/** A path the Host may resolve without guessing a working directory. */
function isAbsoluteHostPath(path) {
  return path.startsWith('/') || path.startsWith('\\\\') || /^[A-Za-z]:[\\/]/.test(path)
}

/** Map a filesystem-provider error code onto the HTTP status the UI reads. */
export function statusForCode(code) {
  switch (code) {
    case 'FS_NOT_FOUND':
      return 404
    case 'FS_NOT_REGULAR_FILE':
      return 409
    case 'FS_STALE_VERSION':
      return 409
    case 'FS_PERMISSION_DENIED':
    case 'FS_SANDBOX_DENIED':
      return 403
    case 'FS_TOO_LARGE':
      return 413
    case 'FS_ABORTED':
      return 499
    default:
      return 500
  }
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Resolve the sandbox policy that should bound this one write.
 *
 * The operator configured the calling Session's mode, so when that Session is
 * live its policy is the deliberate authority for its files. Agentless calls
 * fall back to the deployment default, which the policy service owns.
 */
function policyFor(ctx, sessionId) {
  try {
    const session = typeof sessionId === 'string' && sessionId !== '' ? ctx.sessions.get(sessionId) : undefined
    return session === undefined ? ctx.sandboxPolicy.resolve() : ctx.sandboxPolicy.resolve({ session })
  } catch {
    return undefined
  }
}

/**
 * Save one full UTF-8 document over the composed filesystem.
 *
 * @param ctx - Host context carrying `fs`, `sessions` and `sandboxPolicy`.
 * @param request - authenticated buffered POST request.
 * @returns the JSON response describing the new version or the refusal.
 */
export async function saveFile(ctx, request) {
  request.signal.throwIfAborted()
  let body
  try {
    body = await request.json()
  } catch {
    return failure(400, 'file-open/bad-json', 'request body is not JSON')
  }
  const record = body !== null && typeof body === 'object' ? body : {}
  const { path, content, expectedVersion, force, sessionId } = record
  if (typeof path !== 'string' || path === '') return failure(400, 'file-open/bad-path', 'path must be a non-empty string')
  if (!isAbsoluteHostPath(path)) return failure(400, 'file-open/relative-path', 'path must be absolute')
  if (path.includes('\0')) return failure(400, 'file-open/bad-path', 'path must not contain NUL')
  if (typeof content !== 'string') return failure(400, 'file-open/bad-content', 'content must be a string')
  if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES) {
    return failure(413, 'file-open/too-large', `content exceeds ${String(MAX_CONTENT_BYTES)} bytes`)
  }

  let target
  try {
    target = await ctx.fs.resolve(path, { signal: request.signal })
  } catch (error) {
    return failure(statusForCode(error?.code), error?.code ?? 'file-open/resolve-failed', messageOf(error))
  }

  let info
  try {
    info = await ctx.fs.stat(target, request.signal)
  } catch (error) {
    return failure(statusForCode(error?.code), error?.code ?? 'file-open/stat-failed', messageOf(error))
  }
  if (info === undefined) return failure(404, 'FS_NOT_FOUND', 'file does not exist')
  if (info.type !== 'file') return failure(409, 'FS_NOT_REGULAR_FILE', 'target is not a regular file')

  const guarded = force === true || typeof expectedVersion !== 'string' || expectedVersion === ''
  const expected = guarded ? undefined : { kind: 'replaceIfVersion', version: expectedVersion }
  try {
    const outcome = await ctx.fs.writeText(target, content, expected, request.signal, policyFor(ctx, sessionId))
    return jsonResponse({
      ok: true,
      version: outcome.version,
      operation: outcome.operation,
      bytes: Buffer.byteLength(content, 'utf8'),
    })
  } catch (error) {
    return failure(statusForCode(error?.code), error?.code ?? 'file-open/write-failed', messageOf(error))
  }
}

/**
 * Register both authenticated routes for the lifetime of this plugin.
 *
 * @param ctx - Host context carrying `connection` (the `/api` auth bridge).
 */
export function apply(ctx) {
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: CAPABILITIES_ROUTE,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: () =>
          Promise.resolve(
            jsonResponse({
              ok: true,
              id: name,
              version: VERSION,
              editing: true,
              maxContentBytes: MAX_CONTENT_BYTES,
            }),
          ),
      }),
    'dsh-thoughtdag-file-open: capabilities route',
  )
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: SAVE_ROUTE,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: (request) => saveFile(ctx, request),
      }),
    'dsh-thoughtdag-file-open: save route',
  )
}
