// Interaction test: full-text search, command palette, kanban board, tags and global shortcuts.

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
  'searchDocuments, SearchOverlay, CommandPalette, scrPaletteFilter, scrPaletteTouch, AXL_PALETTE_RECENT, ' +
  'KanbanBoard, App, TagCloud, collectTags, tagHue'

const source = parts.map((name) => fs.readFileSync(path.join(clientDir, name), 'utf8')).join('\n') + '\n;return { ' + exposed + ', model, createStore }\n'

const el = (type, props, ...children) => ({
  type,
  props: props || {},
  children: children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false),
})

let presets = []
let cursor = 0
const cleanups = []
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
  useEffect(fn) {
    // The real shell runs effects after mount; the tiny renderer runs them inline so
    // listener registration (window keydown, subscriptions) is observable.
    if (typeof fn !== 'function') return
    try {
      const cleanup = fn()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    } catch (error) {
      // Effects that touch DOM nodes the stub does not model are irrelevant here.
    }
  },
  useLayoutEffect(fn) {
    reactShim.useEffect(fn)
  },
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

const listeners = { keydown: [] }
const documentStub = {
  head: { appendChild() {}, removeChild() {} },
  body: { appendChild() {} },
  createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, click() {} }),
  addEventListener(type, handler) {
    if (listeners[type]) listeners[type].push(handler)
  },
  removeEventListener() {},
}
const windowStub = {
  addEventListener(type, handler) {
    if (listeners[type]) listeners[type].push(handler)
  },
  removeEventListener() {},
  setTimeout: (fn) => setTimeout(fn, 0),
}
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0)

const mod = new Function('require', 'window', 'document', 'fetch', source)(
  (id) => (id === 'react' ? reactShim : {}),
  windowStub,
  documentStub,
  async () => ({ ok: true, status: 200, text: async () => '{"ok":true,"value":null}' }),
)

let passed = 0
const failures = []
const check = (name, fn) => {
  try {
    fn()
    passed += 1
  } catch (error) {
    failures.push(name + ' :: ' + ((error && error.message) || String(error)).split('\n').slice(0, 3).join(' | '))
  }
}
const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const renderTree = (component, props, statePresets) => {
  const sink = { classes: [], text: [], elements: [] }
  presets = statePresets || []
  cursor = 0
  const walk = (element, depth) => {
    if (element === null || element === undefined || element === false || element === true) return
    if (depth > 80) throw new Error('render recursion too deep')
    if (typeof element === 'string' || typeof element === 'number') {
      sink.text.push(String(element))
      return
    }
    if (Array.isArray(element)) {
      for (const child of element) walk(child, depth + 1)
      return
    }
    if (typeof element !== 'object') return
    const { type, props: elementProps, children } = element
    sink.elements.push({ type, props: elementProps || {} })
    if (elementProps && typeof elementProps.className === 'string') sink.classes.push(elementProps.className)
    const all = (children || []).concat(elementProps && elementProps.children !== undefined ? [].concat(elementProps.children) : [])
    if (typeof type === 'function') {
      if (type.prototype && type.prototype.isReactComponent) walk(new type(elementProps).render(), depth + 1)
      else walk(type(elementProps), depth + 1)
    } else {
      for (const child of all) walk(child, depth + 1)
    }
  }
  walk(el(component, props), 0)
  return sink
}

const hasClass = (sink, needle) => sink.classes.some((value) => String(value).split(/\s+/).includes(needle))
const byClass = (sink, needle) => sink.elements.filter((entry) => typeof entry.props.className === 'string' && entry.props.className.split(/\s+/).includes(needle))
const textOf = (sink) => sink.text.join(' ')

// ---------- fixture ----------
const stamp = '2026-01-01T00:00:00.000Z'
const at = (day) => '2026-01-0' + day + 'T00:00:00.000Z'
const fixture = () => ({
  version: 1,
  workspaces: [{ id: 'ws-1', name: 'Docs HQ', icon: 'book', createdAt: stamp, updatedAt: stamp }],
  nodes: [
    {
      id: 'doc-a',
      workspaceId: 'ws-1',
      parentId: null,
      kind: 'doc',
      title: 'Welcome guide',
      status: 'active',
      tags: ['intro', 'guide'],
      favorite: true,
      trashed: false,
      order: 0,
      createdAt: stamp,
      updatedAt: at(3),
      content: '# Welcome guide\n\nScriptorium knowledge base notes.\n',
    },
    {
      id: 'doc-b',
      workspaceId: 'ws-1',
      parentId: null,
      kind: 'doc',
      title: 'Nested note',
      status: 'done',
      tags: ['guide'],
      favorite: false,
      trashed: false,
      order: 1,
      createdAt: stamp,
      updatedAt: at(1),
      content: 'Short memo without the key term.\n',
    },
    {
      id: 'doc-c',
      workspaceId: 'ws-1',
      parentId: null,
      kind: 'doc',
      title: 'Knowledge base',
      status: 'draft',
      tags: [],
      favorite: false,
      trashed: false,
      order: 2,
      createdAt: stamp,
      updatedAt: at(4),
      content: 'Title only match, body says something else.\n',
    },
    {
      id: 'doc-d',
      workspaceId: 'ws-1',
      parentId: null,
      kind: 'doc',
      title: 'Trashed memo',
      status: 'draft',
      tags: ['guide'],
      favorite: false,
      trashed: true,
      trashedAt: at(2),
      order: 3,
      createdAt: stamp,
      updatedAt: at(2),
      content: 'knowledge in the bin\n',
    },
    { id: 'folder-1', workspaceId: 'ws-1', parentId: null, kind: 'folder', title: 'Folder', status: 'draft', tags: [], favorite: false, trashed: false, order: 4, updatedAt: at(1) },
  ],
  settings: { view: 'list', editorMode: 'split', fontSize: 15, autoSave: true, showLineNumbers: true, sort: 'manual' },
  ui: { activeWorkspaceId: 'ws-1', activeNodeId: 'doc-a', expanded: [] },
})

const snapshot = fixture()
const ids = (results) => results.map((entry) => entry.node.id).join(',')
const hits = (segments) => segments.filter((segment) => segment.hit === true).length

// ---------- search ----------
check('search finds title matches and highlights them', () => {
  const results = mod.searchDocuments(snapshot, 'welcome', {})
  assert(results.length === 1 && results[0].node.id === 'doc-a', 'unexpected results: ' + ids(results))
  assert(hits(results[0].titleSegments) >= 1, 'title match not highlighted')
})

check('search finds body matches with a highlighted excerpt', () => {
  const results = mod.searchDocuments(snapshot, 'key term', {})
  assert(results.length === 1 && results[0].node.id === 'doc-b', 'unexpected results: ' + ids(results))
  assert(hits(results[0].excerptSegments) >= 1, 'excerpt match not highlighted')
})

check('search ranks title hits above body hits', () => {
  const results = mod.searchDocuments(snapshot, 'knowledge', {})
  assert(results.length === 2, 'unexpected result count: ' + ids(results))
  assert(results[0].node.id === 'doc-c', 'title match should rank first, got ' + ids(results))
  assert(results[1].node.id === 'doc-a', 'body match should follow, got ' + ids(results))
  assert(results[0].score > results[1].score, 'scores are not ordered: ' + results[0].score + ' vs ' + results[1].score)
})

check('search matches tags', () => {
  const results = mod.searchDocuments(snapshot, 'guide', {})
  const found = ids(results)
  assert(found.includes('doc-b'), 'tag-only match missing: ' + found)
})

check('search skips trashed documents unless asked', () => {
  const normal = mod.searchDocuments(snapshot, 'knowledge', {})
  assert(!ids(normal).includes('doc-d'), 'trashed document leaked into results')
  const withTrash = mod.searchDocuments(snapshot, 'knowledge', { includeTrashed: true })
  assert(ids(withTrash).includes('doc-d'), 'includeTrashed did not add the trashed document')
})

check('search with a blank query lists recent documents', () => {
  const results = mod.searchDocuments(snapshot, '', {})
  assert(results.length === 3, 'unexpected count: ' + ids(results))
  assert(results[0].node.id === 'doc-c', 'most recent document should come first: ' + ids(results))
  const limited = mod.searchDocuments(snapshot, '', { limit: 2 })
  assert(limited.length === 2, 'limit ignored: ' + limited.length)
})

check('search returns nothing for an unknown term', () => {
  const results = mod.searchDocuments(snapshot, 'zzzz-nothing', {})
  assert(results.length === 0, 'expected no results, got ' + ids(results))
})

check('search honours the workspace filter', () => {
  const other = JSON.parse(JSON.stringify(snapshot))
  other.workspaces.push({ id: 'ws-2', name: 'Other', icon: 'book', createdAt: stamp, updatedAt: stamp })
  other.nodes.push({ id: 'doc-foreign', workspaceId: 'ws-2', parentId: null, kind: 'doc', title: 'Foreign knowledge', status: 'draft', tags: [], favorite: false, trashed: false, order: 0, updatedAt: at(5), content: 'knowledge\n' })
  const scoped = mod.searchDocuments(other, 'knowledge', { workspaceId: 'ws-1' })
  assert(!ids(scoped).includes('doc-foreign'), 'workspace filter ignored: ' + ids(scoped))
  const all = mod.searchDocuments(other, 'knowledge', {})
  assert(ids(all).includes('doc-foreign'), 'unscoped search should include the other workspace')
})

check('the search overlay highlights hits and picks on Enter', () => {
  const picked = []
  let closed = 0
  const sink = renderTree(mod.SearchOverlay, {
    snapshot,
    query: 'knowledge',
    onQueryChange() {},
    onPick: (node) => picked.push(node.id),
    onClose: () => (closed += 1),
    workspaceId: 'ws-1',
  })
  assert(hasClass(sink, 'dsh-scr-search-hit'), 'no highlighted segment rendered')
  assert(textOf(sink).replace(/\s+/g, ' ').includes('Knowledge base'), 'result title missing')
  const panel = byClass(sink, 'dsh-scr-search-panel')[0]
  assert(panel !== undefined, 'search panel missing')
  let prevented = 0
  panel.props.onKeyDown({ key: 'Enter', preventDefault: () => (prevented += 1) })
  assert(prevented === 1, 'Enter default not prevented')
  assert(picked.length === 1 && picked[0] === 'doc-c', 'Enter picked ' + JSON.stringify(picked))
  panel.props.onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} })
  assert(closed === 1, 'Escape did not close the overlay')
})

// ---------- palette ----------
const commands = [
  { id: 'new-doc', title: 'New document', hint: 'Ctrl+N', group: 'Create', run: () => {} },
  { id: 'export', title: 'Export archive', hint: 'JSON', group: 'Data', run: () => {} },
  { id: 'settings', title: 'Open settings', group: 'Data', run: () => {} },
]

check('the palette filters fuzzily and drops non-matches', () => {
  const filtered = mod.scrPaletteFilter(commands, 'newdoc').map((command) => command.id)
  assert(filtered.length === 1 && filtered[0] === 'new-doc', 'unexpected fuzzy result: ' + filtered.join(','))
  const empty = mod.scrPaletteFilter(commands, 'zzzz')
  assert(empty.length === 0, 'non-matching query returned entries')
  const all = mod.scrPaletteFilter(commands, '')
  assert(all.length === 3, 'blank query should list every command, got ' + all.length)
})

check('recently used commands float to the top of the palette', () => {
  mod.AXL_PALETTE_RECENT.length = 0
  mod.scrPaletteTouch('export')
  const ordered = mod.scrPaletteFilter(commands, '').map((command) => command.id)
  assert(ordered[0] === 'export', 'recent command not first: ' + ordered.join(','))
  mod.scrPaletteTouch('settings')
  const again = mod.scrPaletteFilter(commands, '').map((command) => command.id)
  assert(again[0] === 'settings' && again[1] === 'export', 'recency order lost: ' + again.join(','))
  mod.scrPaletteTouch('settings')
  assert(mod.AXL_PALETTE_RECENT.filter((id) => id === 'settings').length === 1, 'recency must not duplicate entries')
  mod.AXL_PALETTE_RECENT.length = 0
})

check('the palette renders groups and runs the selected command', () => {
  const ran = []
  let closed = 0
  const local = commands.map((command) => Object.assign({}, command, { run: () => ran.push(command.id) }))
  const sink = renderTree(mod.CommandPalette, { commands: local, onClose: () => (closed += 1) })
  assert(textOf(sink).includes('New document') && textOf(sink).includes('Export archive'), 'command titles missing')
  assert(byClass(sink, 'dsh-scr-palette-group').length === 2, 'expected two groups')
  const rows = byClass(sink, 'dsh-scr-palette-row')
  assert(rows.length === 3, 'expected a row per command, got ' + rows.length)
  assert(typeof rows[0].props.onClick === 'function', 'palette row is not clickable')
  rows[0].props.onClick()
  assert(ran.length === 1 && ran[0] === 'new-doc', 'command did not run: ' + JSON.stringify(ran))
  assert(closed === 1, 'palette did not close after running')
  assert(mod.AXL_PALETTE_RECENT[0] === 'new-doc', 'palette did not record the last command')
  mod.AXL_PALETTE_RECENT.length = 0
})

// ---------- board ----------
const makeStore = (snap) => {
  const commits = []
  return {
    commits,
    snapshot: snap,
    commit: (mutator) => {
      commits.push(1)
      mutator(snap)
    },
  }
}

check('the board renders the three status columns with cards', () => {
  const snap = fixture()
  const store = makeStore(snap)
  const sink = renderTree(mod.KanbanBoard, { store, snapshot: snap, onOpen() {}, workspaceId: 'ws-1' })
  const columns = byClass(sink, 'dsh-scr-board-col')
  assert(columns.length === 3, 'expected three columns, got ' + columns.length)
  const text = textOf(sink)
  for (const label of ['Draft', 'Active', 'Done']) assert(text.includes(label), 'column label missing: ' + label)
  assert(byClass(sink, 'dsh-scr-board-card').length === 3, 'expected three cards')
})

check('dragging a card to another column persists the new status', () => {
  const snap = fixture()
  const store = makeStore(snap)
  const sink = renderTree(mod.KanbanBoard, { store, snapshot: snap, onOpen() {}, workspaceId: 'ws-1' })
  const cards = byClass(sink, 'dsh-scr-board-card')
  const card = cards.find((entry) => entry.props['data-node'] === 'doc-b' || JSON.stringify(entry.props).includes('doc-b'))
  assert(card !== undefined, 'doc-b card missing')
  const payload = {}
  card.props.onDragStart({ dataTransfer: { setData: (type, value) => (payload[type] = value), effectAllowed: '' } })
  const columns = byClass(sink, 'dsh-scr-board-col')
  const draftColumn = columns[0]
  draftColumn.props.onDrop({ preventDefault() {}, dataTransfer: { getData: (type) => payload[type] || '' } })
  const moved = snap.nodes.find((node) => node.id === 'doc-b')
  assert(moved.status === 'draft', 'status not persisted: ' + moved.status)
  assert(store.commits.length >= 1, 'change was not committed through the store')
})

check('dropping an unknown card id changes nothing', () => {
  const snap = fixture()
  const store = makeStore(snap)
  const sink = renderTree(mod.KanbanBoard, { store, snapshot: snap, onOpen() {}, workspaceId: 'ws-1' })
  const columns = byClass(sink, 'dsh-scr-board-col')
  columns[2].props.onDrop({ preventDefault() {}, dataTransfer: { getData: () => 'does-not-exist' } })
  assert(snap.nodes.find((node) => node.id === 'doc-a').status === 'active', 'an unknown id changed a status')
  assert(store.commits.length === 0, 'an unknown id was committed')
})

check('an empty workspace shows one placeholder per column', () => {
  const snap = fixture()
  snap.nodes = []
  const store = makeStore(snap)
  const sink = renderTree(mod.KanbanBoard, { store, snapshot: snap, onOpen() {}, workspaceId: 'ws-1' })
  assert(byClass(sink, 'dsh-scr-board-empty').length === 3, 'expected three empty placeholders')
})

// ---------- tags ----------
check('tags can be added, removed and counted', () => {
  const snap = fixture()
  mod.model.addTag(snap, 'doc-a', 'fresh')
  assert(snap.nodes[0].tags.includes('fresh'), 'tag was not added')
  mod.model.addTag(snap, 'doc-a', 'fresh')
  assert(snap.nodes[0].tags.filter((tag) => tag === 'fresh').length === 1, 'duplicate tag added')
  mod.model.removeTag(snap, 'doc-a', 'fresh')
  assert(!snap.nodes[0].tags.includes('fresh'), 'tag was not removed')
  const counts = mod.collectTags(snap)
  const guide = counts.find((entry) => entry.tag === 'guide')
  assert(guide !== undefined && guide.count === 2, 'tag counts wrong: ' + JSON.stringify(counts))
})

check('tag colours are stable and in range', () => {
  const first = mod.tagHue('guide')
  const second = mod.tagHue('guide')
  const other = mod.tagHue('intro')
  assert(first === second, 'tag colour is not stable')
  assert(typeof first === 'number' && first >= 0 && first <= 360, 'hue out of range: ' + first)
  assert(first !== other, 'different tags should look different')
})

check('the tag view lists only documents carrying the tag', () => {
  const snap = fixture()
  const calls = { commit: 0 }
  const store = {
    state: { snapshot: snap, revision: 1, updatedAt: stamp, status: 'ready', error: null, saveState: 'saved', saveError: null, storage: null },
    subscribe: () => () => {},
    load: async () => {},
    commit: () => (calls.commit += 1),
    saveNow: async () => {},
    replace() {},
    dispose() {},
  }
  const sink = renderTree(mod.App, { store }, [0, 'tag', false, false, false, [], 'guide', ''])
  const text = textOf(sink)
  assert(text.includes('#guide'), 'tag view header missing: ' + text.slice(0, 120))
  assert(text.includes('2 tagged document(s)'), 'tag view count wrong: ' + text.slice(0, 200))
  assert(!text.includes('Knowledge base'), 'untagged document leaked into the tag view')
})

// ---------- shortcuts ----------
const renderApp = (snap, presetsList) => {
  const calls = { commit: 0, saveNow: 0 }
  const store = {
    state: { snapshot: snap, revision: 1, updatedAt: stamp, status: 'ready', error: null, saveState: 'saved', saveError: null, storage: null },
    subscribe: () => () => {},
    load: async () => {},
    commit: () => (calls.commit += 1),
    saveNow: async () => {
      calls.saveNow += 1
    },
    replace() {},
    dispose() {},
  }
  listeners.keydown.length = 0
  renderTree(mod.App, { store }, presetsList || [0, 'doc', false, false, false, [], null, ''])
  return { calls, handler: listeners.keydown[listeners.keydown.length - 1] }
}

check('Ctrl+N is ignored while the caret is in a text field', () => {
  const { calls, handler } = renderApp(fixture())
  assert(typeof handler === 'function', 'App did not register a keydown handler')
  let prevented = 0
  handler({ key: 'n', ctrlKey: true, target: { tagName: 'TEXTAREA' }, preventDefault: () => (prevented += 1) })
  handler({ key: 'n', ctrlKey: true, target: { tagName: 'INPUT' }, preventDefault: () => (prevented += 1) })
  assert(prevented === 0, 'Ctrl+N grabbed the key inside a field')
  assert(calls.commit === 0, 'Ctrl+N created a document while typing')
  handler({ key: 'n', ctrlKey: true, target: { tagName: 'DIV' }, preventDefault: () => (prevented += 1) })
  assert(prevented === 1, 'Ctrl+N outside a field should be handled')
  assert(calls.commit === 1, 'Ctrl+N did not create a document')
})

check('Ctrl+S is left to the editor while typing', () => {
  const { calls, handler } = renderApp(fixture())
  let prevented = 0
  handler({ key: 's', ctrlKey: true, target: { tagName: 'TEXTAREA' }, preventDefault: () => (prevented += 1) })
  assert(prevented === 0 && calls.saveNow === 0, 'the window handler stole Ctrl+S from the editor')
  handler({ key: 's', ctrlKey: true, target: { tagName: 'BODY' }, preventDefault: () => (prevented += 1) })
  assert(prevented === 1 && calls.saveNow === 1, 'Ctrl+S outside a field should save')
})

check('Ctrl+K opens the palette even from a field', () => {
  const { handler } = renderApp(fixture())
  let prevented = 0
  handler({ key: 'k', ctrlKey: true, target: { tagName: 'TEXTAREA' }, preventDefault: () => (prevented += 1) })
  assert(prevented === 1, 'Ctrl+K did not prevent the default action')
})

check('Escape does not throw and leaves the document in place', () => {
  const { handler } = renderApp(fixture(), [0, 'doc', true, false, false, [], null, ''])
  handler({ key: 'Escape', target: { tagName: 'DIV' }, preventDefault() {} })
})

// ---------- report ----------
if (failures.length > 0) {
  console.error('interaction test failures:\n' + failures.map((line) => ' - ' + line).join('\n'))
  console.error(passed + ' passed, ' + failures.length + ' failed')
  process.exit(1)
}
console.log('interactions: ' + passed + ' checks passed')
