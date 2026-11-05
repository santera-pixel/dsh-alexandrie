// Node smoke test for the pure client logic (model, store, markdown, search).
// The parts are plain scripts concatenated by build.mjs, so wrapping them in one
// function with browser-ish stubs exercises exactly the code the panel runs.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const clientDir = path.join(here, '..', 'src', 'client')
const read = (name) => fs.readFileSync(path.join(clientDir, name), 'utf8')

const harness = `
return { emptySnapshot, normalizeSnapshot, seedSnapshot, createStore, model,
  STATUS_ORDER, statusLabelOf, statusTokenOf, workspacesOf, workspaceById, nodeById, aliveNodes,
  trashedNodes, childrenOf, nodeTrail, subtreeIds, wordCountOf, readingMinutesOf, collectTags,
  tagHue, relativeTime, fuzzyScore, matchSegments, excerptFor, docsOf, nextOrder, canReparent,
  ICONS, Icon, renderMarkdown, markdownStats, markdownPlainText, searchDocuments, CSS_CHUNKS }
`

const source = ['00-boot.js', '05-model.js', '10-store.js', '15-markdown.js', '50-search.js']
  .map(read)
  .join('\n')
  .concat('\n', harness)

const reactShim = {
  createElement(type, props, ...children) {
    return { type, props: props || {}, children: children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false) }
  },
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useMemo: (factory) => factory(),
  useRef: (initial) => ({ current: initial }),
  Fragment: 'Fragment',
}

const makeFetch = (handlers) => async (url, init) => {
  const key = String(url).replace('/dsh-scriptorium', '') + ' ' + ((init && init.method) || 'GET')
  const handler = handlers[key]
  if (!handler) throw new Error('unexpected request: ' + key)
  const payload = handler(init && init.body ? JSON.parse(init.body) : null)
  const body = JSON.stringify({ ok: true, value: payload })
  return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) }
}

let passed = 0
const failures = []
const check = (name, fn) => {
  try {
    const result = fn()
    if (result === false) throw new Error('returned false')
    passed += 1
  } catch (error) {
    failures.push(name + ' :: ' + (error && error.message ? error.message : String(error)))
  }
}
const eq = (actual, expected, label) => {
  if (actual !== expected) throw new Error((label || 'value') + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual))
}
const ok = (value, label) => {
  if (!value) throw new Error((label || 'value') + ' is falsy')
}

const run = (fetchImpl) => {
  const factory = new Function('require', 'document', 'window', 'fetch', source)
  const documentStub = {
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, click() {} }),
    addEventListener() {},
    removeEventListener() {},
  }
  return factory((id) => (id === 'react' ? reactShim : {}), documentStub, { addEventListener() {} }, fetchImpl)
}

// ---------- pure model ----------
const api = run(makeFetch({}))
const seeded = api.seedSnapshot()

check('seed has one workspace with three documents', () => {
  eq(api.workspacesOf(seeded).length, 1, 'workspaces')
  eq(api.docsOf(seeded, seeded.workspaces[0].id).length, 3, 'docs')
})
check('tree readers resolve parent and trail', () => {
  const wsId = seeded.workspaces[0].id
  const folder = api.model.createNode(seeded, { workspaceId: wsId, parentId: null, kind: 'folder', title: 'Guides' })
  const child = api.model.createNode(seeded, { workspaceId: wsId, parentId: folder.id, kind: 'doc', title: 'Child', content: 'hello world' })
  eq(api.childrenOf(seeded, wsId, folder.id).length, 1, 'children')
  eq(api.nodeById(seeded, child.id).title, 'Child', 'nodeById')
  eq(api.nodeTrail(seeded, child.id).map((node) => node.id).join('>'), [folder.id, child.id].join('>'), 'trail')
  eq(api.subtreeIds(seeded, folder.id).length, 2, 'subtree')
  eq(api.wordCountOf('one two three'), 3, 'wordCount')
  eq(api.readingMinutesOf('word '.repeat(450)), 2, 'readingMinutes')
})
check('nested reparent guard works', () => {
  const wsId = seeded.workspaces[0].id
  const outer = api.model.createNode(seeded, { workspaceId: wsId, parentId: null, kind: 'folder', title: 'Outer' })
  const inner = api.model.createNode(seeded, { workspaceId: wsId, parentId: outer.id, kind: 'folder', title: 'Inner' })
  eq(api.canReparent(seeded, outer.id, inner.id), false, 'cannot move parent into child')
  eq(api.model.moveNode(seeded, outer.id, inner.id, wsId), false, 'moveNode refuses')
  ok(api.model.moveNode(seeded, inner.id, null, wsId), 'moveNode to root succeeds')
})
check('tags, favourites and status transitions', () => {
  const doc = seeded.nodes[0]
  api.model.addTag(seeded, doc.id, 'guides')
  ok(api.collectTags(seeded).some((entry) => entry.tag === 'guides'), 'tag collected')
  ok(typeof api.tagHue('guides') === 'number' && api.tagHue('guides') >= 0 && api.tagHue('guides') < 360, 'tagHue returns a hue in 0..359')
  api.model.removeTag(seeded, doc.id, 'guides')
  ok(!api.collectTags(seeded).some((entry) => entry.tag === 'guides'), 'tag removed')
  api.model.toggleFavorite(seeded, doc.id)
  ok(api.aliveNodes(seeded).some((node) => node.id === doc.id), 'alive listing')
  api.model.setStatus(seeded, doc.id, 'done')
  eq(api.nodeById(seeded, doc.id).status, 'done', 'status')
  eq(api.statusLabelOf('done'), 'Done', 'status label')
})
check('trash subtree, restore and purge', () => {
  const wsId = seeded.workspaces[0].id
  const folder = api.model.createNode(seeded, { workspaceId: wsId, parentId: null, kind: 'folder', title: 'Temp' })
  const child = api.model.createNode(seeded, { workspaceId: wsId, parentId: folder.id, kind: 'doc', title: 'Temp child', content: 'x' })
  api.model.trashNode(seeded, folder.id)
  ok(api.nodeById(seeded, child.id).trashed, 'child trashed with folder')
  eq(api.trashedNodes(seeded).length, 2, 'trash count')
  api.model.restoreNode(seeded, folder.id)
  ok(!api.trashedNodes(seeded).some((node) => node.id === child.id), 'restored')
  api.model.trashNode(seeded, child.id)
  api.model.purgeNode(seeded, child.id)
  eq(api.nodeById(seeded, child.id), null, 'purged')
})
check('search helpers highlight and rank', () => {
  const segments = api.matchSegments('Hello world', 'wor')
  ok(segments.some((segment) => segment.hit), 'hit segment')
  ok(api.excerptFor('a'.repeat(200) + 'needle' + 'b'.repeat(200), 'needle').indexOf('needle') >= 0, 'excerpt contains needle')
  ok(api.fuzzyScore('abc', 'abc') > api.fuzzyScore('abc', 'zzz'), 'fuzzy ranking')
})
check('settings and ui patches merge', () => {
  api.model.patchSettings(seeded, { fontSize: 17 })
  eq(seeded.settings.fontSize, 17, 'fontSize')
  api.model.patchUi(seeded, { expanded: ['a', 'b'] })
  eq(seeded.ui.expanded.join(','), 'a,b', 'expanded')
})

// ---------- markdown ----------
check('markdown renders without innerHTML and produces elements', () => {
  const tree = api.renderMarkdown(api.seedSnapshot().nodes[0].content, { onToggleTask: () => {} })
  ok(Array.isArray(tree) && tree.length > 4, 'block list')
  const types = new Set()
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    if (typeof node.type === 'string') types.add(node.type)
    ;(node.children || []).forEach(walk)
  }
  tree.forEach(walk)
  ok(types.has('h1') && types.has('h2'), 'headings rendered')
  ok(types.has('table') || types.has('tr'), 'table rendered')
  ok(types.has('pre') || types.has('code'), 'code rendered')
})
check('markdown stats and plain text', () => {
  const stats = api.markdownStats('# Title\n\nsome words here')
  ok(stats.words >= 3, 'words')
  eq(api.markdownPlainText('**bold** text'), 'bold text', 'plain text')
})
check('xss payload stays text', () => {
  const tree = api.renderMarkdown('<img src=x onerror=alert(1)>', {})
  const strings = JSON.stringify(tree)
  ok(strings.indexOf('onerror') >= 0, 'payload kept as literal text')
  ok(strings.indexOf('dangerouslySetInnerHTML') < 0, 'no innerHTML escape hatch')
})

// ---------- search ----------
check('searchDocuments ranks seeded docs', () => {
  const snapshot = api.seedSnapshot()
  const hits = api.searchDocuments(snapshot, 'shortcut', {})
  ok(hits.length >= 1, 'hits')
  eq(hits[0].node.title, 'Keyboard shortcuts', 'top hit')
  ok(Array.isArray(hits[0].titleSegments), 'title segments')
  const none = api.searchDocuments(snapshot, 'zzzz-no-such-term', {})
  eq(none.length, 0, 'no false positives')
})

// ---------- icons ----------
check('every icon used by the UI exists', () => {
  ok(api.ICONS.warning, 'warning icon present')
  ok(api.ICONS.book && api.ICONS.board && api.ICONS.sparkles, 'core icons present')
})

// ---------- store ----------
const storeChecks = async () => {
  let saved = null
  let saveCalls = 0
  const fetchImpl = makeFetch({
    '/state GET': () => ({ revision: 4, updatedAt: '2026-01-01T00:00:00.000Z', snapshot: null }),
    '/health GET': () => ({ directory: 'C:\\tmp', file: 'C:\\tmp\\data.json', exists: true, size: 10 }),
    '/save POST': (body) => {
      saveCalls += 1
      saved = body.snapshot
      return { revision: 4 + saveCalls, updatedAt: '2026-01-01T00:00:01.000Z', conflict: false }
    },
  })
  const store = run(fetchImpl).createStore()
  const seen = []
  store.subscribe(() => seen.push(store.state.saveState))

  await store.load()
  if (store.state.status !== 'ready') throw new Error('load status ' + store.state.status)
  if (store.state.snapshot.workspaces.length !== 1) throw new Error('seed not applied')
  if (saveCalls !== 1) throw new Error('first run should persist the seed, calls=' + saveCalls)

  store.commit((draft) => api.model.setContent(draft, store.state.snapshot.nodes[0].id, '# changed\n\nbody'), { immediate: true })
  await new Promise((resolve) => setTimeout(resolve, 50))
  if (store.state.saveState !== 'saved') throw new Error('saveState ' + store.state.saveState)
  if (!saved || String(saved.nodes[0].content).indexOf('# changed') !== 0) throw new Error('saved content missing')
  if (store.state.revision !== 6) throw new Error('revision ' + store.state.revision)

  store.commit((draft) => api.model.patchSettings(draft, { autoSave: false }))
  await new Promise((resolve) => setTimeout(resolve, 900))
  if (saveCalls !== 2) throw new Error('autoSave=false must not write, calls=' + saveCalls)

  store.dispose()
  return seen.length > 0
}

const storeResult = await storeChecks().then(() => true).catch((error) => error)
check('store loads, seeds, saves and respects autoSave', () => {
  if (storeResult !== true) throw storeResult
})

console.log('passed: ' + passed)
if (failures.length > 0) {
  console.error('failed: ' + failures.length)
  for (const failure of failures) console.error(' - ' + failure)
  process.exit(1)
}
console.log('all smoke checks passed')
