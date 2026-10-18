// @local/thoughtdag-file-open — chunk: the viewer stylesheet.
//
// Every color, radius, shadow and font comes from a DSH theme token, and the
// dialog keeps the Modal primitive's own animation, mask and focus handling:
// only its shape is tightened (a panel radius, a hairline stroke, no default
// header/footer gap) so it reads as a native DSH surface rather than a custom
// window.
window.__ModuleLoader__.load({
  id: '@local/thoughtdag-file-open',
  chunk: 'client.styles.js',
  factory: () => {
    const module = { exports: {} }

    const CSS = `
/* ── dialog shell ────────────────────────────────────────────────────────── */
.dsh-tdfi-dialog.dsh-tdfi-dialog{
  width:min(1120px,94vw);
  height:min(88vh,940px);
  max-height:100%;
  gap:0;
  padding:0;
  overflow:hidden;
  border:0.5px solid var(--dsw-alias-border-l3);
  border-radius:var(--dsw-radius-lg);
  background:var(--dsw-alias-bg-layer-2);
  box-shadow:var(--dsw-elevation-prominent);
}
.dsh-tdfi-shell{
  display:flex;
  flex-direction:column;
  flex:1;
  min-width:0;
  min-height:0;
  height:100%;
  color:var(--dsw-alias-label-primary);
  font-size:13px;
  line-height:20px;
}

/* ── header: tab strip + actions ─────────────────────────────────────────── */
.dsh-tdfi-head{
  display:flex;
  align-items:center;
  gap:8px;
  flex:none;
  min-height:46px;
  padding:6px 8px 6px 10px;
  background:var(--dsw-alias-bg-module-platform);
  border-bottom:0.5px solid var(--dsw-alias-border-l1);
}
.dsh-tdfi-tabs{
  display:flex;
  align-items:center;
  gap:2px;
  flex:1;
  min-width:0;
  overflow-x:auto;
  overflow-y:hidden;
  scrollbar-width:none;
}
.dsh-tdfi-tabs::-webkit-scrollbar{display:none}
.dsh-tdfi-tab{
  display:flex;
  align-items:center;
  gap:6px;
  flex:0 1 auto;
  min-width:0;
  max-width:220px;
  height:30px;
  padding:0 4px 0 8px;
  border:0.5px solid transparent;
  border-radius:var(--dsw-radius-sm);
  background:transparent;
  color:var(--dsw-alias-label-secondary);
  font:inherit;
  font-size:12px;
  line-height:18px;
  cursor:pointer;
  transition:background var(--ds-transition-duration-fast) var(--ds-ease-in-out),
    color var(--ds-transition-duration-fast) var(--ds-ease-in-out);
}
.dsh-tdfi-tab:hover{
  background:var(--dsw-alias-interactive-bg-hover);
  color:var(--dsw-alias-label-primary);
}
.dsh-tdfi-tab[data-active='true']{
  background:var(--dsw-alias-bg-layer-2);
  border-color:var(--dsw-alias-border-l3);
  color:var(--dsw-alias-label-primary);
  box-shadow:var(--dsw-elevation-soft);
}
.dsh-tdfi-tab:focus-visible{
  outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset:-2px;
}
.dsh-tdfi-tab-icon{
  flex:none;
  display:inline-flex;
  align-items:center;
  justify-content:center;
}
.dsh-tdfi-tab-name{
  min-width:0;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.dsh-tdfi-dirty{
  flex:none;
  width:6px;
  height:6px;
  border-radius:50%;
  background:var(--dsw-alias-brand-primary);
}
.dsh-tdfi-tab-close{
  flex:none;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  width:18px;
  height:18px;
  padding:0;
  border:0;
  border-radius:var(--dsw-radius-xs);
  background:transparent;
  color:var(--dsw-alias-label-secondary);
  cursor:pointer;
  opacity:0;
  transition:opacity var(--ds-transition-duration-fast) var(--ds-ease-in-out),
    background var(--ds-transition-duration-fast) var(--ds-ease-in-out);
}
.dsh-tdfi-tab:hover .dsh-tdfi-tab-close,
.dsh-tdfi-tab[data-active='true'] .dsh-tdfi-tab-close,
.dsh-tdfi-tab-close:focus-visible{opacity:1}
.dsh-tdfi-tab-close:hover{
  background:var(--dsw-alias-interactive-bg-active);
  color:var(--dsw-alias-label-primary);
}
.dsh-tdfi-actions{
  display:flex;
  align-items:center;
  gap:6px;
  flex:none;
}
.dsh-tdfi-divider{
  width:1px;
  height:16px;
  margin:0 2px;
  background:var(--dsw-alias-border-l2);
}
.dsh-tdfi-iconbtn{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  width:28px;
  height:28px;
  padding:0;
  border:0;
  border-radius:var(--dsw-radius-sm);
  background:transparent;
  color:var(--dsw-alias-label-secondary);
  cursor:pointer;
  transition:background var(--ds-transition-duration-fast) var(--ds-ease-in-out),
    color var(--ds-transition-duration-fast) var(--ds-ease-in-out);
}
.dsh-tdfi-iconbtn:hover{
  background:var(--dsw-alias-interactive-bg-hover);
  color:var(--dsw-alias-label-primary);
}
.dsh-tdfi-iconbtn:focus-visible{
  outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset:-1px;
}
.dsh-tdfi-iconbtn[disabled]{opacity:0.4;cursor:not-allowed}

/* ── meta row ────────────────────────────────────────────────────────────── */
.dsh-tdfi-meta{
  display:flex;
  align-items:center;
  gap:8px;
  flex:none;
  min-height:30px;
  padding:0 14px;
  border-bottom:0.5px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-2);
  color:var(--dsw-alias-label-tertiary);
  font-size:11.5px;
  line-height:18px;
}
.dsh-tdfi-meta-path{
  min-width:0;
  flex:1;
  font-size:11.5px;
}
.dsh-tdfi-pill{
  flex:none;
  padding:0 6px;
  border-radius:var(--dsw-radius-xs);
  background:var(--dsw-alias-bg-layer-3);
  color:var(--dsw-alias-label-secondary);
  font-size:11px;
  line-height:18px;
  white-space:nowrap;
}
/* The open-in-window action sits at the end of the path row, one step smaller
   than the header icon buttons so it aligns with the 18px pills. */
.dsh-tdfi-meta-action{
  width:24px;
  height:24px;
  margin:0 -6px 0 2px;
}

/* ── body ────────────────────────────────────────────────────────────────── */
.dsh-tdfi-body{
  position:relative;
  display:flex;
  flex-direction:column;
  flex:1;
  min-height:0;
  min-width:0;
  background:var(--dsw-alias-bg-layer-2);
}
.dsh-tdfi-scroll{
  flex:1;
  min-height:0;
  overflow:auto;
  padding:20px 28px 48px;
}
.dsh-tdfi-scroll[data-kind='code']{padding:0}
.dsh-tdfi-scroll[data-kind='markdown']{padding:24px 30px 56px}
.dsh-tdfi-md{
  max-width:860px;
  margin:0 auto;
  min-width:0;
  font-size:14px;
  line-height:1.7;
}
.dsh-tdfi-code{min-width:0}
.dsh-tdfi-media{
  position:relative;
  display:flex;
  align-items:center;
  justify-content:center;
  flex:1;
  min-height:0;
  padding:20px;
}
.dsh-tdfi-media img{
  max-width:100%;
  max-height:100%;
  object-fit:contain;
  border-radius:var(--dsw-radius-md);
  background:var(--dsw-alias-bg-layer-1);
}
.dsh-tdfi-frame{
  flex:1;
  min-height:0;
  display:block;
  width:100%;
  height:100%;
  border:0;
  background:var(--dsw-alias-bg-layer-1);
}
.dsh-tdfi-note{
  padding:0 28px 18px;
  color:var(--dsw-alias-label-tertiary);
  font-size:12px;
  line-height:18px;
}
.dsh-tdfi-loading{
  display:flex;
  align-items:center;
  gap:10px;
  padding:52px 0;
  justify-content:center;
  color:var(--dsw-alias-label-secondary);
  font-size:13px;
}
.dsh-tdfi-error{
  padding:28px 30px;
  color:var(--dsw-alias-state-error-primary);
  font-size:13px;
  line-height:20px;
  word-break:break-word;
}
.dsh-tdfi-empty{
  display:flex;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  gap:14px;
  flex:1;
  padding:48px 32px;
  text-align:center;
  color:var(--dsw-alias-label-secondary);
  font-size:13px;
  line-height:20px;
}
.dsh-tdfi-empty-actions{display:flex;gap:8px;align-items:center}

/* ── conflict banner ─────────────────────────────────────────────────────── */
.dsh-tdfi-banner{
  display:flex;
  align-items:center;
  gap:10px;
  flex:none;
  padding:7px 14px;
  border-bottom:0.5px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-3);
  color:var(--dsw-alias-state-warn-label);
  font-size:12px;
  line-height:18px;
}
.dsh-tdfi-banner-text{flex:1;min-width:0}
.dsh-tdfi-banner-actions{display:flex;gap:6px;flex:none;align-items:center}

/* ── editor ──────────────────────────────────────────────────────────────── */
.dsh-tdfi-editor{
  display:flex;
  flex:1;
  min-height:0;
  min-width:0;
  background:var(--dsw-alias-bg-layer-1);
}
/* CodeMirror fills the dialog body; its chrome is themed from JS with DSH
   tokens, so only the host box and the lazy-load placeholder live here. */
.dsh-tdfi-cm-host{
  position:relative;
  display:flex;
  flex-direction:column;
  flex:1;
  min-height:0;
  min-width:0;
  background:var(--dsw-alias-bg-layer-1);
}
.dsh-tdfi-cm-host .cm-editor{height:100%}
.dsh-tdfi-cm-loading{
  position:absolute;
  inset:0;
  display:flex;
  align-items:center;
  justify-content:center;
  background:var(--dsw-alias-bg-layer-1);
  color:var(--dsw-alias-label-secondary);
  font-size:12px;
}
.dsh-tdfi-editor-fallback{
  display:flex;
  flex:1;
  min-height:0;
  min-width:0;
}
.dsh-tdfi-editor[data-mode='fallback']{flex-direction:column}
.dsh-tdfi-editor-notice{
  flex:none;
  padding:6px 14px;
  border-bottom:0.5px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-3);
  color:var(--dsw-alias-state-warn-label);
  font-size:12px;
  line-height:18px;
}
.dsh-tdfi-gutter{
  flex:none;
  overflow:hidden;
  padding:12px 10px 12px 12px;
  border-right:0.5px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-2);
  color:var(--dsw-alias-label-tertiary);
  font-family:var(--ds-font-family-code);
  font-size:12px;
  line-height:20px;
  text-align:right;
  white-space:pre;
  user-select:none;
  font-variant-numeric:tabular-nums;
}
.dsh-tdfi-textarea{
  flex:1;
  min-width:0;
  min-height:0;
  margin:0;
  padding:12px 16px;
  border:0;
  outline:none;
  resize:none;
  overflow:auto;
  background:transparent;
  color:var(--dsw-alias-label-primary);
  caret-color:var(--dsw-alias-brand-primary);
  font-family:var(--ds-font-family-code);
  font-size:13px;
  line-height:20px;
  tab-size:2;
  white-space:pre;
}
/* Text selection uses the same translucent blue as the document preview's text
   layer. The multi-select alias is a row/table surface token that is nearly
   identical to the editor surface in both themes, so it made a selection
   invisible; the document-selection token is the one meant for selected text. */
.dsh-tdfi-textarea::selection,
.dsh-tdfi-md::selection,
.dsh-tdfi-md ::selection,
.dsh-tdfi-code::selection,
.dsh-tdfi-code ::selection{background:var(--dsw-alias-bg-document-selection)}

/* ── footer ──────────────────────────────────────────────────────────────── */
.dsh-tdfi-foot{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
  flex:none;
  min-height:30px;
  padding:0 14px;
  border-top:0.5px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-2);
  color:var(--dsw-alias-label-tertiary);
  font-size:11px;
  line-height:16px;
}
.dsh-tdfi-state{
  display:flex;
  align-items:center;
  gap:6px;
  min-width:0;
}
.dsh-tdfi-state-label{
  min-width:0;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.dsh-tdfi-hint{
  flex:none;
  color:var(--dsw-alias-label-caption);
  font-variant-numeric:tabular-nums;
}

/* ── unsaved-changes confirmation over the body ──────────────────────────── */
.dsh-tdfi-confirm{
  position:absolute;
  inset:0;
  z-index:5;
  display:flex;
  align-items:center;
  justify-content:center;
  padding:24px;
  background:var(--dsw-alias-bg-mask-2);
}
.dsh-tdfi-confirm-card{
  width:min(380px,100%);
  display:flex;
  flex-direction:column;
  gap:8px;
  padding:18px 18px 14px;
  border:0.5px solid var(--dsw-alias-border-l3);
  border-radius:var(--dsw-radius-lg);
  background:var(--dsw-alias-bg-layer-1);
  box-shadow:var(--dsw-elevation-prominent);
}
.dsh-tdfi-confirm-title{
  margin:0;
  color:var(--dsw-alias-label-primary);
  font-size:14px;
  line-height:22px;
  font-weight:500;
}
.dsh-tdfi-confirm-body{
  margin:0;
  color:var(--dsw-alias-label-secondary);
  font-size:12.5px;
  line-height:20px;
  word-break:break-word;
}
.dsh-tdfi-confirm-actions{
  display:flex;
  justify-content:flex-end;
  gap:8px;
  margin-top:6px;
}

/* ── narrow viewports ────────────────────────────────────────────────────── */
@media (max-width:720px){
  .dsh-tdfi-dialog.dsh-tdfi-dialog{
    width:96vw;
    height:92vh;
  }
  .dsh-tdfi-scroll{padding:16px 16px 40px}
  .dsh-tdfi-scroll[data-kind='markdown']{padding:18px 18px 44px}
  .dsh-tdfi-tab{max-width:150px}
}

@media (prefers-reduced-motion:reduce){
  .dsh-tdfi-tab,
  .dsh-tdfi-tab-close,
  .dsh-tdfi-iconbtn{transition:none}
}

/* Maximized: fill the frame's padding box (the Modal layer already explains
   its insets through these two variables), keeping a slim 12-24px margin so
   the surface still reads as a DSH panel rather than a bare fullscreen div. */
.dsh-tdfi-dialog.dsh-tdfi-maximized.dsh-tdfi-maximized{
  width:calc(100vw - 48px);
  height:calc(100vh - 2 * max(24px, var(--dsh-frame-overlay-top, 24px)));
  max-height:none;
  border-radius:var(--dsw-radius-md);
}
`

    module.exports = { CSS }
    return module.exports
  },
})
