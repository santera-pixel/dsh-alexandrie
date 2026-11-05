// Base stylesheet for the panel shell. Part stylesheets (markdown, search, board) append
// their own chunks through CSS_CHUNKS and are injected together at mount.

const BASE_CSS = `
.dsh-axl-root {
  --axl-sidebar-w: 272px;
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
.dsh-axl-root *, .dsh-axl-root *::before, .dsh-axl-root *::after { box-sizing: border-box; }
.dsh-axl-root :focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; border-radius: 6px; }

/* ---------- header ---------- */
.dsh-axl-header {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: color-mix(in srgb, var(--dsw-alias-bg-base) 88%, var(--dsw-alias-bg-layer-1));
  flex: 0 0 auto;
  z-index: 3;
}
.dsh-axl-brand { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dsh-axl-brand-mark {
  display: grid; place-items: center;
  width: 26px; height: 26px; border-radius: 8px;
  color: var(--dsw-alias-brand-primary);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-brand-primary) 26%, transparent);
}
.dsh-axl-brand-name { font-weight: 650; letter-spacing: .01em; font-size: 13.5px; white-space: nowrap; }
.dsh-axl-crumbs { display: flex; align-items: center; gap: 4px; min-width: 0; overflow: hidden; color: var(--dsw-alias-label-secondary); font-size: 12.5px; }
.dsh-axl-crumb { padding: 2px 6px; border-radius: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 220px; cursor: pointer; transition: background .15s ease, color .15s ease; }
.dsh-axl-crumb:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dsh-axl-crumb-sep { opacity: .5; }
.dsh-axl-spacer { flex: 1 1 auto; }

.dsh-axl-searchbtn {
  display: flex; align-items: center; gap: 8px;
  min-width: 180px; max-width: 320px; flex: 1 1 220px;
  padding: 6px 10px; border-radius: 9px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary);
  font: inherit; font-size: 12.5px; text-align: left; cursor: pointer;
  transition: border-color .15s ease, background .15s ease, color .15s ease;
}
.dsh-axl-searchbtn:hover { border-color: var(--dsw-alias-border-l2); color: var(--dsw-alias-label-primary); }
.dsh-axl-kbd {
  margin-left: auto; font-size: 10.5px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  padding: 1px 5px; border-radius: 5px;
  border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-base);
}

.dsh-axl-seg {
  display: inline-flex; padding: 2px; gap: 2px; border-radius: 9px;
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l1);
}
.dsh-axl-seg-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 4px 9px; border: 0; border-radius: 7px;
  background: transparent; color: var(--dsw-alias-label-secondary);
  font: inherit; font-size: 12px; cursor: pointer;
  transition: background .16s ease, color .16s ease, box-shadow .16s ease;
}
.dsh-axl-seg-btn:hover { color: var(--dsw-alias-label-primary); }
.dsh-axl-seg-btn.is-active {
  background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary);
  box-shadow: 0 1px 2px color-mix(in srgb, var(--dsw-alias-label-primary) 16%, transparent);
}

/* ---------- generic controls ---------- */
.dsh-axl-icon-btn {
  display: inline-grid; place-items: center;
  width: 28px; height: 28px; border-radius: 8px;
  border: 1px solid transparent; background: transparent;
  color: var(--dsw-alias-label-secondary); cursor: pointer;
  transition: background .15s ease, color .15s ease, border-color .15s ease, transform .12s ease;
}
.dsh-axl-icon-btn:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dsh-axl-icon-btn:active { transform: scale(.94); }
.dsh-axl-icon-btn.is-active { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent); color: var(--dsw-alias-brand-primary); }
.dsh-axl-icon-btn.is-danger:hover { color: var(--dsw-alias-state-error-primary); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent); }
.dsh-axl-icon-btn[disabled] { opacity: .4; cursor: not-allowed; }
.dsh-axl-icon-btn--sm { width: 22px; height: 22px; border-radius: 6px; }

.dsh-axl-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 7px 12px; border-radius: 9px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 12.5px; font-weight: 500; cursor: pointer;
  transition: background .15s ease, border-color .15s ease, transform .12s ease, box-shadow .15s ease;
}
.dsh-axl-btn:hover { background: var(--dsw-alias-bg-layer-2); border-color: var(--dsw-alias-border-l2); }
.dsh-axl-btn:active { transform: translateY(1px); }
.dsh-axl-btn.is-primary {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 16%, transparent);
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 46%, transparent);
  color: var(--dsw-alias-brand-primary);
  box-shadow: 0 1px 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 22%, transparent);
}
.dsh-axl-btn.is-primary:hover { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 26%, transparent); }
.dsh-axl-btn.is-ghost { background: transparent; border-color: transparent; color: var(--dsw-alias-label-secondary); }
.dsh-axl-btn.is-ghost:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dsh-axl-btn.is-danger { color: var(--dsw-alias-state-error-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 40%, transparent); }
.dsh-axl-btn.is-danger:hover { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent); }
.dsh-axl-btn[disabled] { opacity: .5; cursor: not-allowed; }

.dsh-axl-input {
  width: 100%; padding: 8px 10px;
  border-radius: 9px; border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 13px;
  transition: border-color .15s ease, box-shadow .15s ease;
}
.dsh-axl-input:focus { border-color: var(--dsw-alias-brand-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, transparent); outline: none; }
.dsh-axl-input::placeholder { color: color-mix(in srgb, var(--dsw-alias-label-secondary) 75%, transparent); }

/* ---------- body layout ---------- */
.dsh-axl-body { display: flex; flex: 1 1 auto; min-height: 0; position: relative; }
.dsh-axl-sidebar {
  display: flex; flex-direction: column; min-height: 0;
  width: var(--axl-sidebar-w); flex: 0 0 auto;
  border-right: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-base);
  transition: width .22s cubic-bezier(.22,.61,.36,1), opacity .18s ease;
  overflow: hidden;
}
.dsh-axl-sidebar.is-collapsed { width: 0; opacity: 0; border-right-color: transparent; }
.dsh-axl-sidebar-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 10px 8px 16px; }
.dsh-axl-sidebar-scroll::-webkit-scrollbar { width: 8px; }
.dsh-axl-sidebar-scroll::-webkit-scrollbar-thumb { background: var(--dsw-alias-border-l1); border-radius: 8px; }

.dsh-axl-section { margin-bottom: 10px; animation: dsh-axl-fade .22s ease both; }
.dsh-axl-section-head {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 6px; margin-bottom: 2px;
  font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase;
  color: var(--dsw-alias-label-secondary);
}
.dsh-axl-section-title { flex: 1 1 auto; }
.dsh-axl-section-count {
  font-size: 10.5px; font-weight: 600; padding: 0 6px; border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary);
}

/* ---------- tree ---------- */
.dsh-axl-tree { display: flex; flex-direction: column; gap: 1px; }
.dsh-axl-tree-children {
  display: grid; grid-template-rows: 0fr;
  transition: grid-template-rows .22s cubic-bezier(.22,.61,.36,1), opacity .18s ease;
  opacity: 0;
}
.dsh-axl-tree-children.is-open { grid-template-rows: 1fr; opacity: 1; }
.dsh-axl-tree-children > div { overflow: hidden; min-height: 0; }

.dsh-axl-tree-row {
  position: relative;
  display: flex; align-items: center; gap: 6px;
  padding: 5px 6px; border-radius: 8px;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer; user-select: none;
  transition: background .14s ease, color .14s ease, padding-left .14s ease;
}
.dsh-axl-tree-row:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dsh-axl-tree-row.is-active { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent); color: var(--dsw-alias-label-primary); font-weight: 550; }
.dsh-axl-tree-row.is-active::before {
  content: ''; position: absolute; left: 0; top: 20%; bottom: 20%;
  width: 2px; border-radius: 2px; background: var(--dsw-alias-brand-primary);
}
.dsh-axl-tree-row.is-dragover { box-shadow: inset 0 0 0 1px var(--dsw-alias-brand-primary); background: color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent); }
.dsh-axl-tree-chevron {
  display: grid; place-items: center; width: 16px; height: 16px;
  border: 0; background: transparent; color: inherit; cursor: pointer; padding: 0;
  transition: transform .2s cubic-bezier(.22,.61,.36,1);
}
.dsh-axl-tree-chevron.is-open { transform: rotate(90deg); }
.dsh-axl-tree-chevron.is-hidden { visibility: hidden; }
.dsh-axl-tree-kind { display: grid; place-items: center; flex: 0 0 auto; opacity: .85; }
.dsh-axl-tree-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.dsh-axl-tree-actions { display: flex; gap: 2px; opacity: 0; transition: opacity .14s ease; }
.dsh-axl-tree-row:hover .dsh-axl-tree-actions,
.dsh-axl-tree-row:focus-within .dsh-axl-tree-actions { opacity: 1; }
.dsh-axl-tree-badge { font-size: 10px; color: var(--dsw-alias-label-secondary); opacity: .8; }

.dsh-axl-ws-row {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 7px; border-radius: 8px; cursor: pointer;
  color: var(--dsw-alias-label-primary);
  transition: background .15s ease;
}
.dsh-axl-ws-row:hover { background: var(--dsw-alias-bg-layer-2); }
.dsh-axl-ws-row.is-active { background: var(--dsw-alias-bg-layer-2); }
.dsh-axl-ws-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--dsw-alias-brand-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, transparent);
}
.dsh-axl-ws-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 550; }
.dsh-axl-ws-text { display: flex; flex: 1 1 auto; flex-direction: column; gap: 1px; min-width: 0; animation: dsh-axl-fade .18s ease both; }
.dsh-axl-ws-path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10.5px; line-height: 1.25; color: var(--dsw-alias-label-secondary); opacity: .8; }
.dsh-axl-ws-row.is-missing .dsh-axl-ws-name { color: var(--dsw-alias-label-secondary); text-decoration: line-through; text-decoration-thickness: 1px; }
.dsh-axl-ws-chip { flex: 0 0 auto; padding: 1px 5px; border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary) 45%, transparent); border-radius: 999px; background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 14%, transparent); color: var(--dsw-alias-state-warn-primary); font-size: 9px; font-weight: 650; letter-spacing: .04em; text-transform: uppercase; }
.dsh-axl-ws-group { margin: 9px 6px 2px; color: var(--dsw-alias-label-secondary); font-size: 9.5px; font-weight: 650; letter-spacing: .07em; text-transform: uppercase; opacity: .72; }
.dsh-axl-ws-empty { padding: 6px 8px; color: var(--dsw-alias-label-secondary); font-size: 11.5px; line-height: 1.4; }
.dsh-axl-ws-link { max-width: 82px; padding: 1px 3px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 10.5px; }
.dsh-axl-ws-link:hover { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-label-primary); }
.dsh-axl-icon-btn.is-spinning svg { animation: dsh-axl-spin .9s linear infinite; }
@keyframes dsh-axl-spin { to { transform: rotate(360deg) } }

.dsh-axl-chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 1.5px 8px; border-radius: 999px;
  font-size: 11px; font-weight: 500; line-height: 1.6;
  border: 1px solid transparent;
  cursor: pointer; white-space: nowrap;
  transition: transform .12s ease, filter .15s ease;
}
.dsh-axl-chip:hover { transform: translateY(-1px); filter: brightness(1.08); }
.dsh-axl-chip.is-active { border-color: currentColor; }
.dsh-axl-chip .dsh-axl-chip-x { border: 0; background: transparent; color: inherit; cursor: pointer; padding: 0; font-size: 12px; line-height: 1; opacity: .7; }
.dsh-axl-chip .dsh-axl-chip-x:hover { opacity: 1; }
.dsh-axl-chip-wrap { display: flex; flex-wrap: wrap; gap: 4px; }

.dsh-axl-sidebar-footer {
  flex: 0 0 auto; display: flex; align-items: center; gap: 4px;
  padding: 8px; border-top: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-base);
}

/* ---------- main ---------- */
.dsh-axl-main { flex: 1 1 auto; min-width: 0; min-height: 0; display: flex; flex-direction: column; position: relative; }
.dsh-axl-main-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
.dsh-axl-main-scroll::-webkit-scrollbar { width: 10px; }
.dsh-axl-main-scroll::-webkit-scrollbar-thumb { background: var(--dsw-alias-border-l1); border-radius: 10px; }
.dsh-axl-view { animation: dsh-axl-fade-up .24s cubic-bezier(.22,.61,.36,1) both; }
/* Canvas and graph own their whole pane: no page scroll, no double scrollbars. */
.dsh-axl-main-scroll:has(> .dsh-axl-view-fill) { overflow: hidden; display: flex; }
.dsh-axl-view-fill { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
/* Canvas and graph own their inner scrolling, so the page scroll is parked while they are open. */
.dsh-axl-view-fill { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.dsh-axl-main-scroll:has(> .dsh-axl-view-fill) { overflow: hidden; display: flex; }

.dsh-axl-doc-head {
  display: flex; flex-direction: column; gap: 8px;
  padding: 18px 22px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.dsh-axl-doc-title {
  width: 100%; border: 0; background: transparent; color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 22px; font-weight: 680; letter-spacing: -.01em;
  padding: 2px 0; border-radius: 6px;
  transition: background .15s ease;
}
.dsh-axl-doc-title:hover { background: var(--dsw-alias-bg-layer-1); }
.dsh-axl-doc-title:focus { outline: none; background: var(--dsw-alias-bg-layer-1); }
.dsh-axl-doc-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.dsh-axl-doc-meta-sep { opacity: .45; }

.dsh-axl-status-pill {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 2px 9px 2px 7px; border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  font-size: 11.5px; font-weight: 600; cursor: pointer; color: var(--dsw-alias-label-primary);
  transition: border-color .15s ease, background .15s ease;
}
.dsh-axl-status-pill:hover { border-color: var(--dsw-alias-border-l2); }
.dsh-axl-status-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 18%, transparent); }

/* ---------- editor ---------- */
.dsh-axl-editor { display: flex; flex-direction: column; min-height: 0; flex: 1 1 auto; }
.dsh-axl-toolbar {
  display: flex; align-items: center; gap: 4px; flex-wrap: wrap;
  padding: 6px 14px; border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: color-mix(in srgb, var(--dsw-alias-bg-base) 92%, var(--dsw-alias-bg-layer-1));
  position: sticky; top: 0; z-index: 2;
}
.dsh-axl-toolbar-group { display: flex; align-items: center; gap: 2px; }
.dsh-axl-toolbar-sep { width: 1px; height: 18px; margin: 0 4px; background: var(--dsw-alias-border-l1); }
.dsh-axl-tool-btn {
  display: inline-grid; place-items: center;
  width: 27px; height: 27px; border-radius: 7px;
  border: 1px solid transparent; background: transparent; color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  transition: background .14s ease, color .14s ease, transform .1s ease;
}
.dsh-axl-tool-btn:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dsh-axl-tool-btn:active { transform: scale(.93); }
.dsh-axl-tool-btn.is-on { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent); color: var(--dsw-alias-brand-primary); }

.dsh-axl-panes { display: flex; flex: 1 1 auto; min-height: 0; }
.dsh-axl-pane { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.dsh-axl-pane.is-edit { flex: 0 0 50%; border-right: 1px solid var(--dsw-alias-border-l1); }
.dsh-axl-pane.is-full { flex: 1 1 100%; }
.dsh-axl-textarea {
  flex: 1 1 auto; width: 100%; min-height: 0; resize: none;
  padding: 18px 22px 40vh;
  border: 0; outline: none;
  background: transparent; color: var(--dsw-alias-label-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  line-height: 1.7; tab-size: 2;
}
.dsh-axl-preview { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 18px 26px 40vh; }
.dsh-axl-preview::-webkit-scrollbar { width: 10px; }
.dsh-axl-preview::-webkit-scrollbar-thumb { background: var(--dsw-alias-border-l1); border-radius: 10px; }
.dsh-axl-pane-label {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 16px; font-size: 10.5px; letter-spacing: .07em; text-transform: uppercase;
  color: var(--dsw-alias-label-secondary);
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}

/* ---------- save state / status ---------- */
.dsh-axl-save-state { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.dsh-axl-save-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-state-idle-primary); transition: background .2s ease; }
.dsh-axl-save-dot.is-saving { background: var(--dsw-alias-state-warn-primary); animation: dsh-axl-pulse 1.1s ease-in-out infinite; }
.dsh-axl-save-dot.is-saved { background: var(--dsw-alias-state-success-primary); }
.dsh-axl-save-dot.is-error { background: var(--dsw-alias-state-error-primary); }
.dsh-axl-error-text { color: var(--dsw-alias-state-error-primary); }

/* ---------- overlays ---------- */
.dsh-axl-backdrop {
  position: absolute; inset: 0; z-index: 20;
  display: flex; align-items: flex-start; justify-content: center;
  padding: 8vh 24px 24px;
  background: color-mix(in srgb, var(--dsw-alias-bg-base) 62%, transparent);
  backdrop-filter: blur(3px);
  animation: dsh-axl-fade .16s ease both;
}
.dsh-axl-modal {
  width: min(680px, 100%); max-height: 78vh;
  display: flex; flex-direction: column;
  border-radius: 14px; overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: 0 24px 60px color-mix(in srgb, var(--dsw-alias-label-primary) 18%, transparent);
  animation: dsh-axl-pop .2s cubic-bezier(.22,.61,.36,1) both;
}
.dsh-axl-modal-head { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dsh-axl-modal-title { flex: 1 1 auto; font-size: 15px; font-weight: 650; }
.dsh-axl-modal-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 14px; }
.dsh-axl-modal-foot { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base); }

.dsh-axl-field { display: flex; flex-direction: column; gap: 6px; }
.dsh-axl-field-label { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary); }
.dsh-axl-field-hint { font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.dsh-axl-switch-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dsh-axl-switch-row:last-child { border-bottom: 0; }
.dsh-axl-switch-text { flex: 1 1 auto; display: flex; flex-direction: column; gap: 2px; }
.dsh-axl-switch-title { font-size: 13px; }
.dsh-axl-switch-hint { font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.dsh-axl-switch {
  width: 38px; height: 22px; border-radius: 999px; border: 0; padding: 2px;
  background: var(--dsw-alias-border-l1); cursor: pointer; display: flex; align-items: center;
  transition: background .18s ease;
}
.dsh-axl-switch.is-on { background: var(--dsw-alias-brand-primary); }
.dsh-axl-switch-knob { width: 18px; height: 18px; border-radius: 50%; background: var(--dsw-alias-bg-base); transition: transform .18s cubic-bezier(.22,.61,.36,1); }
.dsh-axl-switch.is-on .dsh-axl-switch-knob { transform: translateX(16px); }

/* ---------- lists (favorites, trash) ---------- */
.dsh-axl-list { display: flex; flex-direction: column; gap: 4px; }
.dsh-axl-list-row {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 11px; border-radius: 9px;
  border: 1px solid transparent; cursor: pointer;
  transition: background .15s ease, border-color .15s ease, transform .12s ease;
}
.dsh-axl-list-row:hover { background: var(--dsw-alias-bg-layer-2); border-color: var(--dsw-alias-border-l1); }
.dsh-axl-list-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.dsh-axl-list-title { font-size: 13px; font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-axl-list-sub { font-size: 11.5px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-axl-list-actions { display: flex; gap: 2px; opacity: .35; transition: opacity .15s ease; }
.dsh-axl-list-row:hover .dsh-axl-list-actions { opacity: 1; }

/* ---------- empty / skeleton / toast ---------- */
.dsh-axl-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; padding: 48px 24px; text-align: center;
  color: var(--dsw-alias-label-secondary);
  animation: dsh-axl-fade .25s ease both;
}
.dsh-axl-empty-icon {
  display: grid; place-items: center; width: 46px; height: 46px; border-radius: 14px;
  color: var(--dsw-alias-brand-primary);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);
}
.dsh-axl-empty-title { font-size: 14px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dsh-axl-empty-hint { font-size: 12.5px; max-width: 380px; line-height: 1.6; }

.dsh-axl-skeleton { display: flex; flex-direction: column; gap: 10px; padding: 22px; }
.dsh-axl-skeleton-line {
  height: 12px; border-radius: 6px;
  background: linear-gradient(90deg, var(--dsw-alias-bg-layer-2), var(--dsw-alias-bg-layer-1), var(--dsw-alias-bg-layer-2));
  background-size: 200% 100%;
  animation: dsh-axl-shimmer 1.4s ease-in-out infinite;
}
.dsh-axl-skeleton-line:nth-child(2) { width: 78%; }
.dsh-axl-skeleton-line:nth-child(3) { width: 92%; }
.dsh-axl-skeleton-line:nth-child(4) { width: 64%; }

.dsh-axl-toast-stack { position: absolute; right: 16px; bottom: 16px; z-index: 40; display: flex; flex-direction: column; gap: 8px; pointer-events: none; }
.dsh-axl-toast {
  pointer-events: auto;
  display: flex; align-items: center; gap: 8px;
  padding: 9px 13px; border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1));
  color: var(--dsw-alias-label-primary);
  box-shadow: 0 10px 26px color-mix(in srgb, var(--dsw-alias-label-primary) 14%, transparent);
  font-size: 12.5px;
  animation: dsh-axl-toast-in .22s cubic-bezier(.22,.61,.36,1) both;
}
.dsh-axl-toast.is-error { border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, transparent); }
.dsh-axl-toast.is-success { border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 45%, transparent); }

/* ---------- stats ---------- */
.dsh-axl-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; }
.dsh-axl-stat {
  padding: 12px 14px; border-radius: 11px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-base);
}
.dsh-axl-stat-value { font-size: 20px; font-weight: 700; letter-spacing: -.02em; }
.dsh-axl-stat-label { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--dsw-alias-label-secondary); }

.dsh-axl-progress { height: 6px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); overflow: hidden; }
.dsh-axl-progress-fill { height: 100%; border-radius: 999px; background: var(--dsw-alias-brand-primary); transition: width .3s ease; }

/* ---------- animations ---------- */
@keyframes dsh-axl-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes dsh-axl-fade-up { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
@keyframes dsh-axl-pop { from { opacity: 0; transform: translateY(10px) scale(.985) } to { opacity: 1; transform: none } }
@keyframes dsh-axl-toast-in { from { opacity: 0; transform: translateY(10px) scale(.98) } to { opacity: 1; transform: none } }
@keyframes dsh-axl-pulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }
@keyframes dsh-axl-shimmer { 0% { background-position: 200% 0 } 100% { background-position: -200% 0 } }

@media (prefers-reduced-motion: reduce) {
  .dsh-axl-root *, .dsh-axl-root *::before, .dsh-axl-root *::after {
    animation-duration: .001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .001ms !important;
    scroll-behavior: auto !important;
  }
}
@media (max-width: 720px) {
  .dsh-axl-root { --axl-sidebar-w: 220px; }
  .dsh-axl-brand-name, .dsh-axl-crumbs { display: none; }
}
`
