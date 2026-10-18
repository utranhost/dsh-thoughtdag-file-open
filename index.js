/**
 * Host half of @local/dsh-thoughtdag-file-open.
 *
 * The plugin only rewires links inside the ThoughtDAG iframe to the harness's
 * own document preview, so the Host half owns no resources: its row exists so
 * the browser module system serves `client.js`.
 */
export function apply() {}
