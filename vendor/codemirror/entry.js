// Build-time entry for the vendored CodeMirror bundle.
//
// scripts/vendor-codemirror.mjs bundles this file into `client.codemirror.js`
// (an IIFE assigned to `__VENDORED_CODEMIRROR`) which the plugin loads as a
// package-local chunk. Only what the inline editor actually uses is exported,
// so esbuild's tree shaking keeps the artifact as small as possible.
export { Compartment, EditorSelection, EditorState } from '@codemirror/state'
export {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view'
export { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
export {
  HighlightStyle,
  StreamLanguage,
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from '@codemirror/language'
export { closeSearchPanel, highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
export { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
export { GFM } from '@lezer/markdown'
export { markdown, markdownLanguage } from '@codemirror/lang-markdown'
export { javascript } from '@codemirror/lang-javascript'
export { json } from '@codemirror/lang-json'
export { python } from '@codemirror/lang-python'
export { html } from '@codemirror/lang-html'
export { css } from '@codemirror/lang-css'
export { xml } from '@codemirror/lang-xml'
export { yaml } from '@codemirror/lang-yaml'
export { sql } from '@codemirror/lang-sql'
export { shell } from '@codemirror/legacy-modes/mode/shell'
export { tags } from '@lezer/highlight'
