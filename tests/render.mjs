// Render smoke test: concatenates the same client parts build.mjs uses, executes every
// component body with a tiny React shim, and fails on anything that would blank the panel.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const clientDir = path.join(here, '..', 'src', 'client')
const parts = fs
  .readdirSync(clientDir)
  .filter((name) => name.endsWith('.js'))
  .sort()

const exposed =
  'App, Sidebar, DocumentList, FolderView, DocumentEditor, KanbanBoard, SearchOverlay, CommandPalette, ' +
  'SettingsModal, EmptyState, ScriptoriumPanel, PanelBoundary, MediaLibrary, MediaPreview, MediaGrid, MediaCanvas, MindGraph, apply'

const source =
  parts.map((name) => fs.readFileSync(path.join(clientDir, name), 'utf8')).join('\n') +
  '\n;return { ' +
  exposed +
  ', model, CSS_CHUNKS, BASE_CSS, createStore }\n'

const el = (type, props, ...children) => ({
  type,
  props: props || {},
  children: children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false),
})

let presets = []
let cursor = 0
const reactShim = {
  createElement: el,
  Fragment: Symbol('Fragment'),
  useState(initial) {
    const value = cursor < presets.length && presets[cursor] !== undefined ? presets[cursor] : typeof initial === 'function' ? initial() : initial
    cursor += 1
    return [value, () => {}]
  },
  useRef(initial) {
    return { current: initial }
  },
  useEffect() {},
  useLayoutEffect() {},
  useMemo(factory) {
    return factory()
  },
  useCallback(fn) {
    return fn
  },
  Component: class Component {
    constructor(props) {
      this.props = props
      this.state = {}
    }
  },
}

const documentStub = {
  head: { appendChild() {}, removeChild() {} },
  body: { appendChild() {} },
  createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, click() {} }),
  addEventListener() {},
  removeEventListener() {},
}

const api = new Function('require', 'window', 'document', 'fetch', source)(
  (id) => (id === 'react' ? reactShim : {}),
  { addEventListener() {}, removeEventListener() {} },
  documentStub,
  async () => ({ ok: true, status: 200, text: async () => '{}', json: async () => ({}) }),
)

let passed = 0
const failures = []
const check = (name, fn) => {
  try {
    fn()
    passed += 1
  } catch (error) {
    failures.push(name + ' :: ' + ((error && error.stack) || String(error)).split('\n').slice(0, 4).join(' | '))
  }
}

// ---------- fixture ----------
const stamp = '2026-01-01T00:00:00.000Z'
const snapshot = {
  version: 1,
  workspaces: [{ id: 'ws-1', name: 'My knowledge base', icon: 'book', createdAt: stamp, updatedAt: stamp }],
  nodes: [
    {
      id: 'doc-1',
      workspaceId: 'ws-1',
      parentId: null,
      kind: 'doc',
      title: 'Welcome',
      icon: 'sparkles',
      status: 'active',
      tags: ['intro', 'guide'],
      favorite: true,
      trashed: false,
      order: 0,
      createdAt: stamp,
      updatedAt: stamp,
      content:
        '# Welcome\n\nSome **bold** and `code` and $math$.\n\n- [ ] one\n- [x] two\n\n> quote\n\n::: tip\nTip body\n:::\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n```js\nlet x = 1\n```\n\n---\n\n![alt](img.png)\n',
      media: [
        { id: 'media-1', name: 'diagram.png', mime: 'image/png', size: 2048, uploadedAt: '2026-01-02T00:00:00.000Z' },
        { id: 'media-2', name: 'spec.pdf', mime: 'application/pdf', size: 4096, uploadedAt: '2026-01-02T00:00:00.000Z' },
      ],
    },
    { id: 'folder-1', workspaceId: 'ws-1', parentId: null, kind: 'folder', title: 'Folder', status: 'draft', tags: [], favorite: false, trashed: false, order: 1, updatedAt: stamp },
    { id: 'doc-2', workspaceId: 'ws-1', parentId: 'folder-1', kind: 'doc', title: 'Nested', status: 'done', tags: ['guide'], favorite: false, trashed: false, order: 0, updatedAt: stamp, content: 'nested body' },
    { id: 'doc-3', workspaceId: 'ws-1', parentId: null, kind: 'doc', title: 'Deleted', status: 'draft', tags: [], favorite: false, trashed: true, trashedAt: '2026-01-02T00:00:00.000Z', order: 2, updatedAt: '2026-01-02T00:00:00.000Z', content: 'gone' },
  ],
  settings: { view: 'list', editorMode: 'split', fontSize: 15, autoSave: true, showLineNumbers: true, sort: 'manual' },
  ui: { activeWorkspaceId: 'ws-1', activeNodeId: 'doc-1', expanded: ['folder-1'] },
}

const storeState = {
  snapshot,
  revision: 3,
  updatedAt: '2026-01-03T00:00:00.000Z',
  status: 'ready',
  error: null,
  saveState: 'saved',
  saveError: null,
  storage: { directory: 'C:\\Users\\x\\.dsh\\scriptorium', file: 'data.json', exists: true, size: 2048 },
}
const calls = []
const store = {
  state: storeState,
  subscribe: () => () => {},
  load: async () => {},
  commit: (mutator) => {
    calls.push('commit')
    const draft = JSON.parse(JSON.stringify(storeState.snapshot))
    mutator(draft)
    storeState.snapshot = draft
  },
  saveNow: async () => calls.push('saveNow'),
  replace: () => {},
  dispose: () => {},
}

const noop = () => {}
const actions = {
  view: 'doc',
  openNode: noop,
  openView: noop,
  toggleExpanded: noop,
  selectWorkspace: noop,
  createWorkspace: noop,
  renameWorkspace: noop,
  removeWorkspace: noop,
  createDoc: noop,
  createFolder: noop,
  renameNode: noop,
  setContent: noop,
  setStatus: noop,
  toggleFavorite: noop,
  trashNode: noop,
  restoreNode: noop,
  purgeNode: noop,
  moveNode: noop,
  addTag: noop,
  removeTag: noop,
  patchSettings: noop,
  patchUi: noop,
  openSettings: noop,
  saveNow: noop,
  reload: noop,
  emptyTrash: noop,
  exportDocument: noop,
  exportArchive: noop,
  importArchive: noop,
  setTagFilter: noop,
  selectTag: noop,
  notify: noop,
  exportZip: noop,
  importZip: noop,
  uploadMedia: noop,
  removeMedia: noop,
  openPreview: noop,
  closePreview: noop,
  busy: null,
}

// ---------- mini renderer ----------
const render = (element, depth = 0) => {
  if (element === null || element === undefined || element === false || element === true) return
  if (depth > 80) throw new Error('render recursion too deep')
  if (Array.isArray(element)) {
    for (const child of element) render(child, depth + 1)
    return
  }
  if (typeof element !== 'object') return
  const { type, props, children } = element
  const all = (children || []).concat(props && props.children !== undefined ? [].concat(props.children) : [])
  if (typeof type === 'function') {
    if (type.prototype && type.prototype.isReactComponent) {
      const instance = new type(props)
      render(instance.render(), depth + 1)
    } else {
      render(type(props), depth + 1)
    }
  } else {
    for (const child of all) render(child, depth + 1)
  }
}

const renderWith = (component, props, statePresets) => {
  presets = statePresets || []
  cursor = 0
  render(el(component, props))
}

const counts = []
const lastRender = { classes: [], text: [] }
const renderCounted = (component, props, statePresets) => {
  let rendered = 0
  lastRender.classes = []
  lastRender.text = []
  const walk = (element, depth) => {
    if (element === null || element === undefined || element === false || element === true) return
    if (depth > 80) throw new Error('too deep')
    if (typeof element === 'string' || typeof element === 'number') {
      lastRender.text.push(String(element))
      return
    }
    if (Array.isArray(element)) return element.forEach((child) => walk(child, depth + 1))
    if (typeof element !== 'object') return
    const { type, props: elementProps, children } = element
    if (elementProps && typeof elementProps.className === 'string') lastRender.classes.push(elementProps.className)
    const all = (children || []).concat(elementProps && elementProps.children !== undefined ? [].concat(elementProps.children) : [])
    if (typeof type === 'function') {
      rendered += 1
      // React.createElement puts rest args on props.children; mirror that so components
      // receive the body they were given (the old walker dropped them silently).
      const componentProps =
        element.children !== undefined && element.children.length > 0 && elementProps.children === undefined
          ? Object.assign({}, elementProps, { children: element.children.length === 1 ? element.children[0] : element.children.flat(Infinity) })
          : elementProps
      if (type.prototype && type.prototype.isReactComponent) walk(new type(componentProps).render(), depth + 1)
      else walk(type(componentProps), depth + 1)
    } else {
      all.forEach((child) => walk(child, depth + 1))
    }
  }
  presets = statePresets || []
  cursor = 0
  walk(el(component, props), 0)
  counts.push(rendered)
  return rendered
}

const classHas = (needle) => lastRender.classes.some((value) => value.split(/\s+/).includes(needle))
const textHas = (needle) => lastRender.text.join(' ').includes(needle)

// ---------- apply ----------
const registrations = []
const AVAILABLE_SLOTS = new Set(['main', 'sidebar.panellist'])
const slotsStub = {
  inject: (key, factory) => {
    registrations.push({ kind: 'inject', key })
    // the real slots registry is lazy: it calls the factory only once the slot exists
    if (AVAILABLE_SLOTS.has(key) && typeof factory === 'function') factory()
    return noop
  },
  register: (spec, component) => {
    registrations.push({ kind: 'register', spec, component })
    return noop
  },
}
const effects = []

check('apply registers the main panel and the sidebar entry', () => {
  api.apply({ get: (name) => (name === 'slots' ? slotsStub : undefined), effect: (callback) => effects.push(callback) })
  const regs = registrations.filter((entry) => entry.kind === 'register')
  if (regs.length !== 2) throw new Error('expected 2 registrations, got ' + regs.length + ': ' + JSON.stringify(registrations))
  const main = regs.find((entry) => entry.spec.name === 'main')
  if (!main || main.spec.key !== 'dsh-scriptorium') throw new Error('main slot key: ' + JSON.stringify(main && main.spec))
  const row = regs.find((entry) => entry.spec.name === 'sidebar.panellist')
  if (!row || row.spec.id !== 'dsh-scriptorium' || row.spec.order !== 12) throw new Error('sidebar spec: ' + JSON.stringify(row && row.spec))
  if (typeof row.spec.label() !== 'string') throw new Error('label factory must return a string')
  if (typeof main.component !== 'function') throw new Error('main slot must receive the panel component')
})

check('lifecycle disposer runs cleanly', () => {
  const cleanup = effects[0](undefined)
  if (typeof cleanup !== 'function') throw new Error('effect must return a disposer')
  cleanup()
})

// ---------- components ----------
check('Sidebar renders tree, favourites, tags and footer', () => {
  const rendered = renderCounted(api.Sidebar, { snapshot, ui: snapshot.ui, actions, tags: api.model.collectTags(snapshot), activeTag: null })
  if (rendered < 6) throw new Error('only ' + rendered + ' components rendered')
})
check('Sidebar renders with a tag filter and collapsed flag', () => {
  renderWith(api.Sidebar, { snapshot: Object.assign({}, snapshot, { ui: Object.assign({}, snapshot.ui, { sidebarCollapsed: true }) }), ui: Object.assign({}, snapshot.ui, { sidebarCollapsed: true }), actions, tags: api.model.collectTags(snapshot), activeTag: 'guide' })
})
check('Sidebar renders project notebooks, missing chips and unlinked projects', () => {
  const snap = JSON.parse(JSON.stringify(snapshot))
  snap.workspaces = [
    Object.assign({}, snap.workspaces[0], { id: 'ws-bound', name: 'Alpha', path: 'C:\\work\\alpha', projectId: 'p-1' }),
    Object.assign({}, snap.workspaces[0], { id: 'ws-missing', name: 'Beta', path: 'C:\\work\\beta', projectId: 'p-2', projectMissing: true }),
    Object.assign({}, snap.workspaces[0], { id: 'ws-free', name: 'Loose notes', path: undefined, projectId: undefined }),
  ]
  snap.nodes = []
  snap.ui.activeWorkspaceId = 'ws-bound'
  renderCounted(api.Sidebar, {
    snapshot: snap,
    ui: snap.ui,
    actions,
    tags: [],
    activeTag: null,
    projects: [{ id: 'p-3', title: 'Gamma', path: 'C:\\work\\gamma' }],
    projectMode: true,
    projectLoading: false,
    onSync: noop,
    onBind: noop,
  })
  if (!textHas('Alpha') || !textHas('Beta') || !textHas('Loose notes')) throw new Error('project rows missing: ' + lastRender.text.join('|'))
  if (!textHas('missing')) throw new Error('missing chip not rendered')
  if (!classHas('dsh-scr-ws-path')) throw new Error('project path subline not rendered')
  if (!classHas('dsh-scr-ws-link')) throw new Error('unlinked project picker not rendered')
})
check('DocumentList renders live, empty and trashed rows', () => {
  renderWith(api.DocumentList, { nodes: snapshot.nodes, snapshot, actions, onOpen: noop, emptyHint: 'none' })
  renderWith(api.DocumentList, { nodes: [], snapshot, actions, onOpen: noop, emptyHint: 'none' })
  renderWith(api.DocumentList, { nodes: api.model.trashedNodes(snapshot), snapshot, actions, onOpen: noop, showRestore: true })
})
check('FolderView renders its children', () => {
  renderWith(api.FolderView, { snapshot, node: api.model.nodeById(snapshot, 'folder-1'), actions })
})
check('DocumentEditor renders in split mode', () => {
  renderCounted(api.DocumentEditor, { store, snapshot, node: api.model.nodeById(snapshot, 'doc-1'), ui: snapshot.ui, actions })
})
check('DocumentEditor renders write and preview modes', () => {
  for (const mode of ['write', 'preview']) {
    const snap = JSON.parse(JSON.stringify(snapshot))
    snap.settings.editorMode = mode
    renderWith(api.DocumentEditor, { store, snapshot: snap, node: api.model.nodeById(snap, 'doc-1'), ui: snap.ui, actions })
  }
})
check('KanbanBoard renders three columns with cards', () => {
  renderCounted(api.KanbanBoard, { store, snapshot, workspaceId: 'ws-1', onOpen: noop })
  if (!classHas('dsh-scr-board')) throw new Error('missing board root class')
  if (!classHas('dsh-scr-board-cols')) throw new Error('missing board column container')
  const columns = lastRender.classes.filter((value) => value.split(/\s+/).includes('dsh-scr-board-col'))
  if (columns.length !== 3) throw new Error('expected 3 columns, got ' + columns.length)
  for (const label of ['Draft', 'Active', 'Done']) {
    if (!textHas(label)) throw new Error('missing column label ' + label)
  }
  for (const title of ['Welcome', 'Nested']) {
    if (!textHas(title)) throw new Error('missing card title ' + title)
  }
  if (!classHas('dsh-scr-board-card')) throw new Error('missing card class')
})

check('KanbanBoard renders empty columns for an empty workspace', () => {
  renderCounted(api.KanbanBoard, { store, snapshot, workspaceId: 'ws-missing', onOpen: noop })
  const empty = lastRender.classes.filter((value) => value.split(/\s+/).includes('dsh-scr-board-empty'))
  if (empty.length !== 3) throw new Error('expected 3 empty placeholders, got ' + empty.length)
})
check('SearchOverlay renders results and the empty state', () => {
  renderWith(api.SearchOverlay, { snapshot, query: 'welcome', workspaceId: null, onQueryChange: noop, onPick: noop, onClose: noop })
  renderWith(api.SearchOverlay, { snapshot, query: '', workspaceId: null, onQueryChange: noop, onPick: noop, onClose: noop })
  renderWith(api.SearchOverlay, { snapshot, query: 'zzzz-nothing', workspaceId: null, onQueryChange: noop, onPick: noop, onClose: noop })
})
check('CommandPalette renders grouped commands', () => {
  const commands = [
    { id: 'a', title: 'New document', hint: 'Ctrl+N', group: 'Create', icon: 'plus', run: noop },
    { id: 'b', title: 'Open settings', group: 'Navigate', icon: 'settings', run: noop },
  ]
  renderWith(api.CommandPalette, { commands, onClose: noop })
})
check('SettingsModal renders stats, controls and actions', () => {
  const rendered = renderCounted(api.SettingsModal, { snapshot, store, actions, onClose: noop })
  if (rendered < 3) throw new Error('only ' + rendered + ' components rendered')
})
check('EmptyState renders with and without an action', () => {
  renderWith(api.EmptyState, { icon: 'book', title: 'Nothing', hint: 'Nothing here' })
  renderWith(api.EmptyState, { icon: 'book', title: 'Nothing', hint: 'Nothing here', action: el('button', null, 'Go') })
})

check('MediaLibrary renders the sandbox head, filter chips and both attachments', () => {
  renderCounted(api.MediaLibrary, { snapshot, actions, onPreview: noop })
  if (!classHas('dsh-scr-media-library')) throw new Error('missing media library root')
  if (!textHas('Media sandbox')) throw new Error('missing media library title')
  const tiles = lastRender.classes.filter((value) => value.split(/\s+/).includes('dsh-scr-media-tile'))
  if (tiles.length !== 2) throw new Error('expected 2 attachment tiles, got ' + tiles.length)
  if (!textHas('diagram.png')) throw new Error('missing image attachment name')
  if (!textHas('spec.pdf')) throw new Error('missing pdf attachment name')
})
check('MediaPreview renders image and pdf stages', () => {
  renderCounted(api.MediaPreview, { media: snapshot.nodes[0].media[0], onClose: noop })
  if (!classHas('dsh-scr-media-modal')) throw new Error('missing media modal')
  if (!classHas('dsh-scr-media-full')) throw new Error('image stage missing')
  renderCounted(api.MediaPreview, { media: snapshot.nodes[0].media[1], onClose: noop })
  if (!classHas('dsh-scr-media-frame')) throw new Error('pdf iframe missing')
  renderCounted(api.MediaPreview, { media: { id: 'm3', name: 'notes.txt', mime: 'text/plain', size: 10 }, onClose: noop })
})
check('MediaGrid renders attachments, the empty hint and the add-file control', () => {
  renderCounted(api.MediaGrid, { items: snapshot.nodes[0].media, onPreview: noop, onRemove: noop, onUpload: noop })
  if (!classHas('dsh-scr-media-drop')) throw new Error('missing add-file control')
  renderCounted(api.MediaGrid, { items: [], emptyHint: 'Nothing attached yet', onUpload: noop })
  if (!textHas('Nothing attached yet')) throw new Error('missing empty hint')
  if (!classHas('dsh-scr-media-empty')) throw new Error('missing empty placeholder')
})
check('DocumentEditor renders the attachments section with its files', () => {
  renderCounted(api.DocumentEditor, { store, snapshot, node: api.model.nodeById(snapshot, 'doc-1'), ui: snapshot.ui, actions })
  if (!classHas('dsh-scr-editor-media')) throw new Error('missing attachments section')
  if (!textHas('Attachments')) throw new Error('missing attachments heading')
  const tiles = lastRender.classes.filter((value) => value.split(/\s+/).includes('dsh-scr-media-tile'))
  if (tiles.length !== 2) throw new Error('expected 2 attachment tiles in the editor, got ' + tiles.length)
})

// ---------- canvas and graph views ----------
check('MediaCanvas renders an empty stage and its toolbar', () => {
  renderCounted(api.MediaCanvas, { store, snapshot, workspaceId: 'ws-1', onOpen() {}, onPreview() {}, notify() {} })
  if (!classHas('dsh-scr-canvas')) throw new Error('missing canvas root')
  if (!classHas('dsh-scr-canvas-emptystate')) throw new Error('missing empty state')
})

check('MediaCanvas renders cards for placed attachments and documents', () => {
  const withCanvas = JSON.parse(JSON.stringify(snapshot))
  withCanvas.canvas = {
    items: [
      { id: 'media:media-1', kind: 'media', refId: 'media-1', x: 40, y: 60, w: 320, h: 260, z: 0 },
      { id: 'doc:doc-1', kind: 'doc', refId: 'doc-1', x: 420, y: 60, w: 300, h: 240, z: 1 },
    ],
    links: [{ id: 'link:a', from: 'media:media-1', to: 'doc:doc-1' }],
  }
  renderCounted(api.MediaCanvas, { store, snapshot: withCanvas, workspaceId: 'ws-1', onOpen() {}, onPreview() {}, notify() {} })
  const cards = lastRender.classes.filter((value) => value.split(/\s+/).includes('dsh-scr-canvas-card'))
  if (cards.length < 2) throw new Error('expected two canvas cards, got ' + cards.length)
})

check('MindGraph renders nodes, edges and toolbox', () => {
  const linked = JSON.parse(JSON.stringify(snapshot))
  linked.nodes[0].content = 'See [[Nested]] for details.'
  renderCounted(api.MindGraph, { store, snapshot: linked, workspaceId: 'ws-1', onOpen() {}, onConnect() {}, notify() {} })
  if (!classHas('dsh-scr-graph')) throw new Error('missing graph root')
  const nodes = lastRender.classes.filter((value) => value.split(/\s+/).includes('dsh-scr-graph-node'))
  if (nodes.length < 2) throw new Error('expected graph nodes, got ' + nodes.length)
})

// ---------- App across views ----------
const appChecks = [
  ['default document view', []],
  ['board view', [0, 'board']],
  ['favourites view', [0, 'favorites']],
  ['trash view', [0, 'trash']],
  ['search overlay open', [0, 'doc', true]],
  ['command palette open', [0, 'doc', false, true]],
  ['settings modal open', [0, 'doc', false, false, true]],
  ['toasts visible', [0, 'doc', false, false, false, [{ id: 't1', kind: 'success', message: 'Saved' }, { id: 't2', kind: 'error', message: 'Failed' }]]],
  ['tag filter active', [0, 'doc', false, false, false, [], 'intro']],
  ['media sandbox view', [0, 'media']],
  ['media canvas view', [0, 'canvas']],
  ['mind graph view', [0, 'graph']],
  ['media preview open', [0, 'doc', false, false, false, [], null, '', { id: 'media-1', name: 'diagram.png', mime: 'image/png', size: 2048 }]],
]
for (const [label, statePresets] of appChecks) {
  check('App renders ' + label, () => {
    renderWith(api.App, { store }, statePresets)
  })
}

check('App renders the error state', () => {
  const errorStore = Object.assign({}, store, { state: Object.assign({}, storeState, { status: 'error', error: 'host unreachable' }) })
  renderWith(api.App, { store: errorStore })
})
check('App renders the loading skeleton', () => {
  const loadingStore = Object.assign({}, store, { state: Object.assign({}, storeState, { status: 'loading' }) })
  renderWith(api.App, { store: loadingStore })
})
check('App renders an empty archive', () => {
  const emptySnapshot = { version: 1, workspaces: [], nodes: [], settings: snapshot.settings, ui: { activeWorkspaceId: null, activeNodeId: null, expanded: [] } }
  const emptyStore = Object.assign({}, store, { state: Object.assign({}, storeState, { snapshot: emptySnapshot }) })
  renderWith(api.App, { store: emptyStore })
})
check('App renders a document with no selection', () => {
  const noSelection = JSON.parse(JSON.stringify(snapshot))
  noSelection.ui.activeNodeId = null
  const noSelStore = Object.assign({}, store, { state: Object.assign({}, storeState, { snapshot: noSelection }) })
  renderWith(api.App, { store: noSelStore })
})

check('PanelBoundary shows children and an error card', () => {
  const boundary = new api.PanelBoundary({})
  boundary.props = { children: el('div', null, 'ok') }
  boundary.state = { error: null }
  renderWith(() => boundary.render())
  boundary.state = { error: new Error('boom') }
  renderWith(() => boundary.render())
})

check('CSS chunks are non-empty', () => {
  if (typeof api.BASE_CSS !== 'string' || api.BASE_CSS.length < 2000) throw new Error('base css missing')
  if (!Array.isArray(api.CSS_CHUNKS) || api.CSS_CHUNKS.length < 1) throw new Error('no part css chunks')
})

console.log('passed: ' + passed + ' · components rendered per check: ' + counts.join(','))
if (failures.length > 0) {
  console.error('failed: ' + failures.length)
  for (const failure of failures) console.error(' - ' + failure)
  process.exit(1)
}
console.log('all render checks passed')
