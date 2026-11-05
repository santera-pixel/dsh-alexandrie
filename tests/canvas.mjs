// Canvas unit tests: pure geometry, mutation rules and snapshot sanitising.
// The component itself is driven end-to-end by tests/gui.mjs.

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
  'canvasModel, graphModel, model, normalizeSnapshot, emptySnapshot, allMedia, mediaOf'

const source =
  parts.map((name) => fs.readFileSync(path.join(clientDir, name), 'utf8')).join('\n') +
  '\n;return { ' + exposed + ' }\n'

const react = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  Fragment: Symbol('Fragment'),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useRef: (initial) => ({ current: initial }),
  useEffect() {},
  useLayoutEffect() {},
  useMemo: (factory) => factory(),
  useCallback: (fn) => fn,
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
  (id) => (id === 'react' ? react : {}),
  { addEventListener() {}, removeEventListener() {} },
  documentStub,
  async () => ({ ok: true, status: 200, text: async () => '{}', json: async () => ({}) }),
)

const { canvasModel, model, normalizeSnapshot, emptySnapshot } = api

let passed = 0
const failures = []
const check = (name, fn) => {
  try {
    fn()
    passed += 1
  } catch (error) {
    failures.push(name + ' :: ' + ((error && error.message) || String(error)))
  }
}
const ok = (condition, message) => {
  if (!condition) throw new Error(message || 'expected truthy')
}
const equal = (actual, expected, message) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error((message || 'values differ') + ': ' + JSON.stringify(actual) + ' !== ' + JSON.stringify(expected))
  }
}
const near = (actual, expected, tolerance, message) => {
  if (!(Math.abs(actual - expected) <= tolerance)) {
    throw new Error((message || 'not close') + ': ' + actual + ' vs ' + expected)
  }
}

/* ------------------------------------------------------------------ fixture */

const stamp = '2026-01-01T00:00:00.000Z'
const media = (id, name) => ({ id, name, mime: 'image/png', size: 100, uploadedAt: stamp })
const snapshot = {
  version: 1,
  workspaces: [{ id: 'ws-1', name: 'Studio', createdAt: stamp, updatedAt: stamp }],
  nodes: [
    {
      id: 'doc-1',
      workspaceId: 'ws-1',
      parentId: null,
      kind: 'doc',
      title: 'Moodboard',
      status: 'active',
      tags: [],
      favorite: false,
      trashed: false,
      order: 0,
      createdAt: stamp,
      updatedAt: stamp,
      content: '![shot](media-1)',
      media: [media('media-1', 'shot.png')],
    },
    { id: 'doc-2', workspaceId: 'ws-1', parentId: null, kind: 'doc', title: 'Trashed', status: 'draft', tags: [], favorite: false, trashed: true, order: 1, createdAt: stamp, updatedAt: stamp, content: '' },
    { id: 'folder-1', workspaceId: 'ws-1', parentId: null, kind: 'folder', title: 'Folder', status: 'draft', tags: [], favorite: false, trashed: false, order: 2, createdAt: stamp, updatedAt: stamp },
  ],
  settings: { autoSave: true },
  ui: {},
  canvas: { items: [], links: [] },
  graph: { showTags: false, showLabels: true, scopeAll: false },
}

const draft = () => JSON.parse(JSON.stringify(snapshot))
const entry = { media: media('media-1', 'shot.png'), node: snapshot.nodes[0] }

/* -------------------------------------------------------------------- checks */

check('item ids round-trip through canvasRefOf', () => {
  equal(canvasModel.canvasItemId('media', 'abc'), 'media:abc')
  equal(canvasModel.canvasRefOf('doc:n-1'), { kind: 'doc', refId: 'n-1' })
  equal(canvasModel.canvasRefOf('media:a:b'), { kind: 'media', refId: 'a:b' })
  equal(canvasModel.canvasRefOf('tag:one'), null)
  equal(canvasModel.canvasRefOf('doc:'), null)
  equal(canvasModel.canvasRefOf(''), null)
  equal(canvasModel.canvasRefOf(null), null)
})

check('slots are deterministic, distinct and never negative', () => {
  const first = canvasModel.canvasSlot(0)
  const second = canvasModel.canvasSlot(1)
  const third = canvasModel.canvasSlot(2)
  equal(canvasModel.canvasSlot(0), first)
  ok(first.x !== second.x || first.y !== second.y, 'first two slots overlap')
  ok(third.y > first.y, 'grid does not wrap to a new row')
  equal(canvasModel.canvasSlot(-4), first)
  equal(canvasModel.canvasSlot(2.9), third)
})

check('ensureItem dedupes by target and applies default geometry', () => {
  const state = draft()
  const item = canvasModel.canvasEnsureItem(state, 'media', 'media-1')
  equal(item.id, 'media:media-1')
  equal([item.w, item.h], [300, 240])
  equal(item.z, 0)
  const again = canvasModel.canvasEnsureItem(state, 'media', 'media-1', { x: 999, y: 999 })
  ok(again === item, 'returned a different object for the same target')
  equal(state.canvas.items.length, 1)
})

check('syncMedia places the attachment, its document and their link once', () => {
  const state = draft()
  equal(canvasModel.canvasSyncMedia(state, [entry]), 1)
  equal(state.canvas.items.length, 2)
  const ids = state.canvas.items.map((item) => item.id).sort()
  equal(ids, ['doc:doc-1', 'media:media-1'])
  equal(state.canvas.links.length, 1)
  equal(state.canvas.links[0].id, 'link:doc:doc-1::media:media-1')
  equal(canvasModel.canvasSyncMedia(state, [entry]), 0)
  equal(state.canvas.items.length, 2)
  equal(state.canvas.links.length, 1)
})

check('move and resize stay finite and respect the hard limits', () => {
  const state = draft()
  canvasModel.canvasEnsureItem(state, 'media', 'media-1')
  const id = 'media:media-1'
  canvasModel.canvasMoveItem(state, id, 42.6, -17.2)
  equal([state.canvas.items[0].x, state.canvas.items[0].y], [43, -17])
  canvasModel.canvasMoveItem(state, id, Number.NaN, undefined)
  equal([state.canvas.items[0].x, state.canvas.items[0].y], [43, -17], 'NaN moved the card')
  canvasModel.canvasResizeItem(state, id, 10, 5000)
  equal([state.canvas.items[0].w, state.canvas.items[0].h], [180, 760])
  canvasModel.canvasResizeItem(state, id, 9000, -3)
  equal([state.canvas.items[0].w, state.canvas.items[0].h], [760, 140])
})

check('raise puts the card above every other card', () => {
  const state = draft()
  const a = canvasModel.canvasEnsureItem(state, 'media', 'media-1')
  const link = canvasModel.canvasEnsureItem(state, 'doc', 'doc-1')
  canvasModel.canvasRaiseItem(state, a.id)
  ok(a.z > link.z, 'raised card is not on top')
  canvasModel.canvasRaiseItem(state, 'media:missing')
  ok(Number.isFinite(a.z), 'raising a missing card corrupted z')
})

check('removing an item removes both of its edges, never other edges', () => {
  const state = draft()
  canvasModel.canvasEnsureItem(state, 'media', 'media-1')
  canvasModel.canvasEnsureItem(state, 'doc', 'doc-1')
  canvasModel.canvasEnsureItem(state, 'doc', 'doc-2')
  canvasModel.canvasLink(state, 'media:media-1', 'doc:doc-1')
  canvasModel.canvasLink(state, 'media:media-1', 'doc:doc-2')
  canvasModel.canvasRemoveItem(state, 'media:media-1')
  equal(state.canvas.items.map((item) => item.id).sort(), ['doc:doc-1', 'doc:doc-2'])
  equal(state.canvas.links.length, 0)
})

check('links are undirected, deduped and need both cards', () => {
  const state = draft()
  canvasModel.canvasEnsureItem(state, 'doc', 'doc-1')
  canvasModel.canvasEnsureItem(state, 'doc', 'doc-2')
  const first = canvasModel.canvasLink(state, 'doc:doc-1', 'doc:doc-2')
  const second = canvasModel.canvasLink(state, 'doc:doc-2', 'doc:doc-1')
  ok(first === second, 'reverse link created a second edge')
  equal(state.canvas.links.length, 1)
  equal(canvasModel.canvasLink(state, 'doc:doc-1', 'doc:not-there'), null)
  equal(canvasModel.canvasLink(state, 'doc:doc-1', 'doc:doc-1'), null)
  canvasModel.canvasRemoveLink(state, first.id)
  equal(state.canvas.links.length, 0)
})

check('resolved rows hide trashed documents and missing attachments', () => {
  const state = draft()
  canvasModel.canvasEnsureItem(state, 'media', 'media-1')
  canvasModel.canvasEnsureItem(state, 'media', 'media-missing')
  canvasModel.canvasEnsureItem(state, 'doc', 'doc-2')
  canvasModel.canvasEnsureItem(state, 'doc', 'folder-1')
  const rows = canvasModel.canvasResolved(state)
  equal(rows.map((row) => row.item.id), ['media:media-1'])
})

check('edge paths join the facing sides with finite coordinates', () => {
  const horizontal = canvasModel.canvasEdgePath({ x: 0, y: 0, w: 100, h: 100 }, { x: 400, y: 0, w: 100, h: 100 })
  const vertical = canvasModel.canvasEdgePath({ x: 0, y: 0, w: 100, h: 100 }, { x: 0, y: 400, w: 100, h: 100 })
  ok(/^M[\d.-]+ [\d.-]+ C/.test(horizontal), 'horizontal path is not a cubic bezier: ' + horizontal)
  ok(/^M[\d.-]+ [\d.-]+ C/.test(vertical), 'vertical path is not a cubic bezier: ' + vertical)
  ok(!/NaN|Infinity|undefined/.test(horizontal + vertical), 'path contains a non-number')
})

check('fit centres the content and clamps the zoom', () => {
  const items = [{ x: 100, y: 50, w: 300, h: 200 }]
  const view = canvasModel.canvasFit(items, { w: 800, h: 600 }, 40)
  ok(view.zoom > 0.25 && view.zoom <= 1.35, 'fit zoom out of range: ' + view.zoom)
  const centreX = (100 + 150) * view.zoom + view.x
  const centreY = (50 + 100) * view.zoom + view.y
  near(centreX, 400, 0.01, 'content is not horizontally centred')
  near(centreY, 300, 0.01, 'content is not vertically centred')
  equal(canvasModel.canvasFit([], { w: 800, h: 600 }), { x: 0, y: 0, zoom: 1 })
})

check('zoom keeps the anchor under the pointer and respects the limits', () => {
  const anchor = { x: 240, y: 180 }
  const view = { x: 30, y: -20, zoom: 1 }
  const zoomed = canvasModel.canvasZoom(view, 2, anchor)
  near((anchor.x - zoomed.x) / zoomed.zoom, (anchor.x - view.x) / view.zoom, 0.001, 'anchor drifted on x')
  near((anchor.y - zoomed.y) / zoomed.zoom, (anchor.y - view.y) / view.zoom, 0.001, 'anchor drifted on y')
  const maxed = canvasModel.canvasZoom(view, 50, anchor)
  equal(maxed.zoom, canvasModel.CANVAS_ZOOM_MAX)
  const minned = canvasModel.canvasZoom(view, 0.001, anchor)
  equal(minned.zoom, canvasModel.CANVAS_ZOOM_MIN)
})

check('normalizeSnapshot rebuilds a hostile canvas safely', () => {
  const raw = {
    workspaces: snapshot.workspaces,
    nodes: snapshot.nodes,
    canvas: {
      items: [
        { id: 'media:media-1', kind: 'media', refId: 'media-1', x: '12', y: 4.7, w: 9999, h: 1, z: '3' },
        { id: 'media:media-1', kind: 'media', refId: 'media-1', x: 100, y: 100 },
        { kind: 'media', refId: 'media-1' },
        { kind: 'wat', refId: 'nope' },
        { kind: 'media', refId: '' },
        { id: 'doc:doc-1', kind: 'doc', refId: 'doc-1', x: 320, y: 0 },
        null,
      ],
      links: [
        { from: 'media:media-1', to: 'doc:doc-1' },
        { from: 'doc:doc-1', to: 'media:media-1' },
        { from: 'media:media-1', to: 'media:missing' },
        { from: 'media:media-1' },
        null,
      ],
    },
    graph: { showTags: 'yes', showLabels: false, scopeAll: 1 },
  }
  const state = normalizeSnapshot(raw)
  equal(state.canvas.items.length, 2)
  equal([state.canvas.items[0].x, state.canvas.items[0].y], [0, 5])
  equal([state.canvas.items[0].w, state.canvas.items[0].h], [760, 140])
  equal(state.canvas.items[0].z, 0)
  equal(state.canvas.links.length, 1)
  equal(state.canvas.links[0].from, 'media:media-1')
  equal(state.graph, { showTags: false, showLabels: false, scopeAll: false })
})

check('normalizeSnapshot tolerates a missing or non-object canvas', () => {
  equal(normalizeSnapshot({ workspaces: [], nodes: [] }).canvas, { items: [], links: [] })
  equal(normalizeSnapshot({ workspaces: [], nodes: [], canvas: 'x' }).canvas, { items: [], links: [] })
  equal(normalizeSnapshot({ workspaces: [], nodes: [], canvas: null }).graph, emptySnapshot().graph)
})

check('a media item survives a JSON round-trip', () => {
  const state = draft()
  canvasModel.canvasSyncMedia(state, [entry])
  canvasModel.canvasMoveItem(state, 'media:media-1', 333, 222)
  const reloaded = normalizeSnapshot(JSON.parse(JSON.stringify(state)))
  const item = reloaded.canvas.items.find((row) => row.id === 'media:media-1')
  equal([item.x, item.y], [333, 222])
  equal(reloaded.canvas.links.length, 1)
})

check('normalizeSnapshot canonicalises persisted link ids', () => {
  const raw = {
    workspaces: [],
    nodes: [],
    canvas: {
      items: [
        { kind: 'doc', refId: 'a' },
        { kind: 'doc', refId: 'b' },
      ],
      links: [{ id: 'weird', from: 'doc:a', to: 'doc:b' }],
    },
  }
  const state = normalizeSnapshot(raw)
  equal(state.canvas.links.length, 1)
  equal(state.canvas.links[0].id, 'link:doc:a::doc:b')
})

check('purging a document clears its canvas cards and the attachments it owned', () => {
  const state = draft()
  canvasModel.canvasSyncMedia(state, [entry])
  equal(state.canvas.items.length, 2)
  model.purgeNode(state, 'doc-1')
  equal(state.canvas.items.length, 0, 'ghost cards survived a purge')
  equal(state.canvas.links.length, 0, 'ghost links survived a purge')
})

check('removing an attachment clears its canvas card and edges', () => {
  const state = draft()
  canvasModel.canvasSyncMedia(state, [entry])
  model.removeMedia(state, 'doc-1', 'media-1')
  equal(state.canvas.items.map((item) => item.id), ['doc:doc-1'])
  equal(state.canvas.links.length, 0)
})

check('canvasSyncMedia offsets the owner by the real card width', () => {
  const state = draft()
  const mediaItem = canvasModel.canvasEnsureItem(state, 'media', 'media-1')
  canvasModel.canvasResizeItem(state, mediaItem.id, 520, 300)
  canvasModel.canvasSyncMedia(state, [entry])
  const docItem = state.canvas.items.find((item) => item.id === 'doc:doc-1')
  equal(docItem.x, mediaItem.x + 520 + 46, 'owner card overlaps a wide attachment')
})

console.log('canvas: ' + passed + ' checks passed')
if (failures.length > 0) {
  for (const failure of failures) console.error('FAIL ' + failure)
  process.exit(1)
}
void model
