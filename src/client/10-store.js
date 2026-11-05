// Authoritative client state: one snapshot object mirrored to the host store.

const STORE_VERSION = 1
const SAVE_DEBOUNCE_MS = 700

function emptySnapshot() {
  return {
    version: STORE_VERSION,
    workspaces: [],
    nodes: [],
    settings: {
      view: 'list',
      editorMode: 'split',
      fontSize: 15,
      autoSave: true,
      showLineNumbers: true,
      sort: 'manual',
    },
    ui: {
      activeWorkspaceId: null,
      activeNodeId: null,
      expanded: [],
    },
    // Freeform media canvas: cards for attachments and the documents they belong to.
    canvas: {
      items: [],
      links: [],
    },
    // Mind-graph display preferences (the graph itself is derived from note bodies).
    graph: {
      showTags: false,
      showLabels: true,
      scopeAll: false,
    },
  }
}

const canvasNumber = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)

/** Keep canvas data navigable: known kinds, unique ids, numeric geometry, live links. */
function normalizeCanvasData(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const items = []
  const itemIds = new Set()
  if (Array.isArray(source.items)) {
    for (const entry of source.items) {
      if (entry === null || typeof entry !== 'object') continue
      const kind = entry.kind === 'doc' || entry.kind === 'media' ? entry.kind : null
      const refId = typeof entry.refId === 'string' ? entry.refId : ''
      if (kind === null || refId === '') continue
      const id = kind + ':' + refId
      if (itemIds.has(id)) continue
      itemIds.add(id)
      items.push({
        id,
        kind,
        refId,
        x: Math.round(canvasNumber(entry.x, 0)),
        y: Math.round(canvasNumber(entry.y, 0)),
        w: Math.round(Math.min(760, Math.max(180, canvasNumber(entry.w, 300)))),
        h: Math.round(Math.min(760, Math.max(140, canvasNumber(entry.h, 240)))),
        z: Math.round(canvasNumber(entry.z, items.length)),
      })
    }
  }
  const links = []
  const pairs = new Set()
  if (Array.isArray(source.links)) {
    for (const link of source.links) {
      if (link === null || typeof link !== 'object') continue
      const from = typeof link.from === 'string' ? link.from : ''
      const to = typeof link.to === 'string' ? link.to : ''
      if (from === '' || to === '' || from === to) continue
      if (!itemIds.has(from) || !itemIds.has(to)) continue
      const pair = [from, to].sort()
      const key = pair[0] + '::' + pair[1]
      if (pairs.has(key)) continue
      pairs.add(key)
      links.push({ id: 'link:' + pair[0] + '::' + pair[1], from, to })
    }
  }
  return { items, links }
}

function normalizeGraphPrefs(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  return {
    showTags: source.showTags === true,
    showLabels: source.showLabels !== false,
    scopeAll: source.scopeAll === true,
  }
}

/** Top-level blocks this build reads and writes; anything else is carried through. */
const SNAPSHOT_KEYS = new Set(['version', 'workspaces', 'nodes', 'settings', 'ui', 'canvas', 'graph'])
/** Keys that must stay prototype-safe when copied off a JSON payload. */
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

/** Coerce whatever came back from disk into the exact shape the UI expects. */
function normalizeSnapshot(raw) {
  const base = emptySnapshot()
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return base
  const snapshot = {
    version: STORE_VERSION,
    workspaces: Array.isArray(raw.workspaces) ? raw.workspaces : base.workspaces,
    nodes: Array.isArray(raw.nodes) ? raw.nodes : base.nodes,
    settings: Object.assign({}, base.settings, raw.settings && typeof raw.settings === 'object' ? raw.settings : {}),
    ui: Object.assign({}, base.ui, raw.ui && typeof raw.ui === 'object' ? raw.ui : {}),
    canvas: normalizeCanvasData(raw.canvas),
    graph: normalizeGraphPrefs(raw.graph),
  }
  // The archive on disk is the only copy of the data, so a build must never erase a
  // top-level block it does not recognise: a newer build's block, or another
  // feature's block, would disappear on the next autosave. Adding canvas/graph to
  // old archives is only safe because the same rule protects the blocks after them.
  for (const key of Object.keys(raw)) {
    if (SNAPSHOT_KEYS.has(key) || UNSAFE_KEYS.has(key)) continue
    snapshot[key] = raw[key]
  }
  return snapshot
}

const deepClone = (value) =>
  typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value))

/** Seed content shown on a first run, so the workspace is never an intimidating blank page. */
function seedSnapshot() {
  const snapshot = emptySnapshot()
  const workspaceId = uid('ws')
  const guideId = uid('doc')
  const shortcutsId = uid('doc')
  const boardId = uid('doc')
  const stamp = nowIso()
  snapshot.workspaces = [
    { id: workspaceId, name: 'My knowledge base', icon: 'book', color: 'brand', createdAt: stamp, updatedAt: stamp },
  ]
  snapshot.nodes = [
    {
      id: guideId,
      workspaceId,
      parentId: null,
      kind: 'doc',
      title: 'Welcome to Alexandrie',
      icon: 'sparkles',
      status: 'active',
      tags: ['intro'],
      favorite: true,
      trashed: false,
      order: 0,
      createdAt: stamp,
      updatedAt: stamp,
      content: [
        '# Welcome to Alexandrie',
        '',
        'Alexandrie is a self-hosted knowledge base with an extended Markdown editor.',
        'This plugin brings the same workflow into the DeepSeek Harness Web GUI.',
        '',
        '## What you can do here',
        '',
        '- Organize notes into **workspaces**, **folders** and nested documents',
        '- Write Markdown with a live preview, tables, task lists and code blocks',
        '- Search everything with `Ctrl+K` or the search box',
        '- Track documents on a kanban board by status',
        '- Tag, favorite and archive without losing anything',
        '',
        '> Everything is stored in one JSON file on the host, so your notes survive UI reloads.',
        '',
        '## Try it',
        '',
        '- [ ] Rename this document',
        '- [ ] Create a folder from the sidebar',
        '- [x] Read the welcome note',
        '',
        '```js',
        "const notes = await alexandrie.search('markdown')",
        'console.log(notes.length)',
        '```',
        '',
        '| Shortcut | Action |',
        '| --- | --- |',
        '| Ctrl+K | Command palette |',
        '| Ctrl+S | Save now |',
        '| Ctrl+N | New document |',
      ].join('\n'),
    },
    {
      id: shortcutsId,
      workspaceId,
      parentId: null,
      kind: 'doc',
      title: 'Keyboard shortcuts',
      icon: 'keyboard',
      status: 'draft',
      tags: ['reference'],
      favorite: false,
      trashed: false,
      order: 1,
      createdAt: stamp,
      updatedAt: stamp,
      content: ['# Keyboard shortcuts', '', '- `Ctrl+K` — command palette', '- `Ctrl+S` — save immediately', '- `Ctrl+N` — new document', '- `Ctrl+B` / `Ctrl+I` — bold / italic', '- `Esc` — close overlays'].join('\n'),
    },
    {
      id: boardId,
      workspaceId,
      parentId: null,
      kind: 'doc',
      title: 'Release checklist',
      icon: 'check',
      status: 'done',
      tags: ['release'],
      favorite: false,
      trashed: false,
      order: 2,
      createdAt: stamp,
      updatedAt: stamp,
      content: ['# Release checklist', '', '1. Draft the notes', '2. Review the board', '3. Export the archive'].join('\n'),
    },
  ]
  snapshot.ui.activeWorkspaceId = workspaceId
  snapshot.ui.activeNodeId = guideId
  return snapshot
}

/** Read an exported JSON payload; throws with a readable reason the UI can toast. */
function parseJsonArchive(text) {
  let parsed
  try {
    parsed = JSON.parse(String(text === undefined || text === null ? '' : text))
  } catch {
    throw new Error('file is not valid JSON')
  }
  const candidate = parsed !== null && typeof parsed === 'object' && parsed.snapshot !== null && typeof parsed.snapshot === 'object' ? parsed.snapshot : parsed
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('file does not contain a document tree')
  if (!Array.isArray(candidate.workspaces)) throw new Error('import needs a "workspaces" array')
  if (!Array.isArray(candidate.nodes)) throw new Error('import needs a "nodes" array')
  for (const node of candidate.nodes) {
    if (node === null || typeof node !== 'object' || typeof node.id !== 'string' || node.id === '') {
      throw new Error('every imported node needs a non-empty id')
    }
  }
  return candidate
}

/**
 * Fold an imported canvas into the local one. Imported cards are added only when
 * their document/attachment survived the merge, imported links only when both
 * cards exist, and the local layout is never moved or replaced. Merging the same
 * archive twice therefore changes nothing.
 */
function mergeCanvasData(current, incoming, nodeIds, mediaIds) {
  const base = normalizeCanvasData(current)
  const extra = normalizeCanvasData(incoming)
  const items = base.items.slice()
  const present = new Set(items.map((item) => item.id))
  for (const item of extra.items) {
    if (present.has(item.id)) continue
    if (item.kind === 'doc' ? !nodeIds.has(item.refId) : !mediaIds.has(item.refId)) continue
    present.add(item.id)
    items.push(item)
  }
  const links = base.links.slice()
  const pairs = new Set(base.links.map((link) => [link.from, link.to].sort().join('::')))
  for (const link of extra.links) {
    if (!present.has(link.from) || !present.has(link.to)) continue
    const key = [link.from, link.to].sort().join('::')
    if (pairs.has(key)) continue
    pairs.add(key)
    links.push({ id: 'link:' + key, from: link.from, to: link.to })
  }
  return { items, links }
}

/** Merge an imported snapshot into the current one: nothing is replaced or overwritten. */
function mergeSnapshot(current, incoming) {
  const base = normalizeSnapshot(current)
  const extra = normalizeSnapshot(incoming)
  const workspaceIds = new Set(base.workspaces.map((workspace) => workspace.id))
  const nodeIds = new Set(base.nodes.map((node) => node.id))
  const workspaces = base.workspaces.concat(extra.workspaces.filter((workspace) => !workspaceIds.has(workspace.id)))
  const keptWorkspaces = new Set(workspaces.map((workspace) => workspace.id))
  const incomingNodes = extra.nodes.filter((node) => !nodeIds.has(node.id) && keptWorkspaces.has(node.workspaceId))
  const keptNodes = new Set(base.nodes.map((node) => node.id).concat(incomingNodes.map((node) => node.id)))
  const nodes = base.nodes.concat(
    incomingNodes.map((node) => (node.parentId !== null && node.parentId !== undefined && !keptNodes.has(node.parentId) ? Object.assign({}, node, { parentId: null }) : node)),
  )
  const mediaIds = new Set()
  for (const node of nodes) {
    for (const item of Array.isArray(node.media) ? node.media : []) {
      if (item !== null && typeof item === 'object' && typeof item.id === 'string') mediaIds.add(item.id)
    }
  }
  const canvas = mergeCanvasData(base.canvas, extra.canvas, keptNodes, mediaIds)
  return Object.assign({}, base, { workspaces, nodes, canvas })
}

/** Observable store backed by the host route. */
function createStore() {  const listeners = new Set()
  const state = {
    snapshot: emptySnapshot(),
    revision: 0,
    updatedAt: null,
    status: 'loading',
    error: null,
    saveState: 'idle',
    saveError: null,
    storage: null,
    // DSH projects reported by the host; the plugin never invents or deletes them.
    projects: {
      status: 'idle',
      projects: [],
      defaultProjectId: null,
      directory: null,
      source: null,
      exists: false,
      warning: null,
      error: null,
      syncedAt: null,
    },
  }

  const emit = () => {
    for (const listener of listeners) {
      try {
        listener()
      } catch (error) {
        console.error('[dsh-alexandrie] listener failed', error)
      }
    }
  }

  const replace = (snapshot) => {
    state.snapshot = snapshot
    emit()
  }

  const saveNow = async () => {
    if (state.status === 'loading') return
    state.saveState = 'saving'
    state.saveError = null
    emit()
    try {
      const result = await api('/save', { method: 'POST', body: { snapshot: state.snapshot } })
      state.revision = result.revision
      state.updatedAt = result.updatedAt
      state.saveState = 'saved'
      emit()
    } catch (error) {
      state.saveState = 'error'
      state.saveError = (error && error.message) || String(error)
      emit()
    }
  }

  const scheduleSave = debounce(saveNow, SAVE_DEBOUNCE_MS)

  /** Mutate a clone of the snapshot, then persist on the debounce (or immediately). */
  const commit = (mutator, options = {}) => {
    const draft = deepClone(state.snapshot)
    mutator(draft)
    state.snapshot = draft
    emit()
    if (options.immediate === true) {
      scheduleSave.cancel()
      void saveNow()
    } else if (draft.settings.autoSave !== false) {
      scheduleSave()
    }
    return draft
  }

  /** Read the Harness project list; the host owns it, this store only mirrors it. */
  const syncProjects = async () => {
    state.projects = Object.assign({}, state.projects, { status: 'loading', error: null })
    emit()
    try {
      const result = await api('/projects')
      const projects = result !== null && typeof result === 'object' && Array.isArray(result.projects) ? result.projects : []
      state.projects = {
        status: 'ready',
        projects,
        defaultProjectId: (result && result.defaultProjectId) || null,
        directory: (result && result.directory) || null,
        source: (result && result.source) || null,
        exists: Boolean(result && result.exists),
        warning: (result && result.warning) || null,
        error: null,
        syncedAt: nowIso(),
      }
      emit()
      return state.projects
    } catch (error) {
      state.projects = Object.assign({}, state.projects, { status: 'error', error: (error && error.message) || String(error) })
      emit()
      throw error
    }
  }

  const load = async () => {
    state.status = 'loading'
    state.error = null
    emit()
    try {
      const [result, health] = await Promise.all([api('/state'), api('/health')])
      state.storage = health
      state.revision = result.revision || 0
      state.updatedAt = result.updatedAt || null
      if (result.snapshot === null || typeof result.snapshot !== 'object') {
        state.snapshot = seedSnapshot()
        state.status = 'ready'
        emit()
        await saveNow()
      } else {
        state.snapshot = normalizeSnapshot(result.snapshot)
        state.status = 'ready'
        emit()
      }
    } catch (error) {
      state.status = 'error'
      state.error = (error && error.message) || String(error)
      emit()
    }
  }

  return {
    state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    load,
    syncProjects,
    commit,
    saveNow,
    replace,
    dispose() {
      scheduleSave.cancel()
      listeners.clear()
    },
  }
}
