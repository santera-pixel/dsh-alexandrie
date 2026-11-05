// Canvas import tests: an exported board must carry its layout into both import paths.
//   - ZIP: lib/archive.js remapSnapshot remaps cards, owners and link endpoints in the
//     same pass as document/media ids, drops what did not survive and dedupes links.
//   - JSON: src/client/10-store.js mergeSnapshot keeps the target layout and folds the
//     imported canvas in, deterministically and idempotently.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { remapSnapshot } from '../lib/archive.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(here, '..', 'src', 'client', '10-store.js'), 'utf8')
const factory = new Function('require', 'window', 'document', 'fetch', source + '\n;return { mergeSnapshot, normalizeCanvasData, emptySnapshot }\n')
const { mergeSnapshot, emptySnapshot } = factory(() => ({}), {}, {}, () => null)

let passed = 0
const check = (title, fn) => {
  try {
    fn()
    passed += 1
    console.log('ok   ' + title)
  } catch (error) {
    console.error('FAIL ' + title)
    console.error(error && error.stack ? error.stack : error)
    process.exitCode = 1
  }
}

const stamp = '2026-01-01T00:00:00.000Z'
const mediaItem = (id) => ({ id, name: id + '.png', mime: 'image/png', size: 10, uploadedAt: stamp })
const node = (id, workspaceId, extra = {}) =>
  Object.assign(
    {
      id,
      workspaceId,
      parentId: null,
      kind: 'doc',
      title: id,
      status: 'active',
      tags: [],
      favorite: false,
      trashed: false,
      order: 0,
      createdAt: stamp,
      updatedAt: stamp,
      content: '',
    },
    extra,
  )

/* ------------------------------------------------------------------ ZIP remap */

const zipSnapshot = {
  version: 1,
  workspaces: [{ id: 'ws-1', name: 'Studio', icon: 'book', createdAt: stamp, updatedAt: stamp }],
  nodes: [
    node('doc-1', 'ws-1', { media: [mediaItem('media-1')] }),
    node('doc-2', 'ws-1', { order: 1 }),
    node('folder-1', 'ws-1', { kind: 'folder', order: 2 }),
  ],
  settings: { autoSave: true },
  ui: { activeWorkspaceId: 'ws-1', activeNodeId: 'doc-1', expanded: [] },
  canvas: {
    items: [
      { id: 'doc:doc-1', kind: 'doc', refId: 'doc-1', x: 120, y: 60, w: 320, h: 260, z: 0 },
      { id: 'media:media-1', kind: 'media', refId: 'media-1', x: 520, y: 240, w: 300, h: 240, z: 1 },
      { id: 'doc:doc-2', kind: 'doc', refId: 'doc-2', x: 900, y: 90, w: 260, h: 200, z: 2 },
    ],
    links: [
      { id: 'link:doc:doc-1::media:media-1', from: 'doc:doc-1', to: 'media:media-1' },
      { id: 'link:doc:doc-1::doc:doc-2', from: 'doc:doc-1', to: 'doc:doc-2' },
    ],
  },
  graph: { showTags: true, showLabels: false, scopeAll: true },
}

const mediaFiles = [{ originalId: 'media-1', name: 'shot.png', mime: 'image/png', size: 4, data: Buffer.from([1, 2, 3, 4]) }]

check('ZIP remap carries every card and link onto the fresh document/media ids', () => {
  const remapped = remapSnapshot(zipSnapshot, mediaFiles)
  const newId = (oldId) => remapped.snapshot.nodes.find((entry) => entry.title === oldId).id
  const mediaNew = remapped.media[0].id
  const items = remapped.snapshot.canvas.items
  assert.equal(items.length, 3)
  const byId = Object.fromEntries(items.map((item) => [item.id, item]))
  assert.ok(byId['doc:' + newId('doc-1')], 'doc card uses the remapped document id')
  assert.ok(byId['doc:' + newId('doc-2')], 'second doc card remapped too')
  assert.ok(byId['media:' + mediaNew], 'media card uses the stored attachment id')
  const first = byId['doc:' + newId('doc-1')]
  assert.deepEqual([first.x, first.y, first.w, first.h, first.z], [120, 60, 320, 260, 0], 'geometry is preserved')
  assert.equal(first.refId, newId('doc-1'))
  assert.ok(!items.some((item) => item.id.includes('doc-1') || item.id.includes('media-1')), 'no original id leaks through')
  const links = remapped.snapshot.canvas.links
  assert.equal(links.length, 2)
  for (const link of links) {
    assert.ok(byId[link.from] && byId[link.to], 'link endpoints exist as cards')
    assert.equal(link.id, 'link:' + [link.from, link.to].sort().join('::'), 'canonical link id')
  }
  assert.deepEqual(remapped.snapshot.graph, zipSnapshot.graph, 'graph preferences travel with the archive')
})

check('ZIP remap drops dangling cards/links and dedupes repeated ids', () => {
  const dirty = JSON.parse(JSON.stringify(zipSnapshot))
  dirty.canvas.items.push({ id: 'doc:ghost', kind: 'doc', refId: 'ghost', x: 0, y: 0, w: 300, h: 240, z: 9 })
  dirty.canvas.items.push({ id: 'media:media-9', kind: 'media', refId: 'media-9', x: 0, y: 0, w: 300, h: 240, z: 9 })
  dirty.canvas.items.push({ id: 'doc:doc-1', kind: 'doc', refId: 'doc-1', x: 5, y: 5, w: 300, h: 240, z: 9 })
  dirty.canvas.links.push({ id: 'link:doc:doc-1::doc:doc-2', from: 'doc:doc-1', to: 'doc:doc-2' })
  dirty.canvas.links.push({ id: 'link:doc:doc-1::doc:ghost', from: 'doc:doc-1', to: 'doc:ghost' })
  const remapped = remapSnapshot(dirty, mediaFiles)
  assert.equal(remapped.snapshot.canvas.items.length, 3, 'ghost doc, missing media and duplicate card are dropped')
  assert.equal(remapped.snapshot.canvas.links.length, 2, 'duplicate and dangling links are dropped')
})

check('ZIP remap degrades safely when the archive has no usable canvas', () => {
  for (const canvas of [undefined, null, 42, 'nope', { items: 'x', links: 'y' }, { items: [null, {}, { kind: 'doc' }], links: [null, {}] }]) {
    const dirty = JSON.parse(JSON.stringify(zipSnapshot))
    if (canvas === undefined) delete dirty.canvas
    else dirty.canvas = canvas
    const remapped = remapSnapshot(dirty, mediaFiles)
    assert.deepEqual(remapped.snapshot.canvas, { items: [], links: [] })
    assert.equal(remapped.snapshot.nodes.length, 3, 'documents are still imported')
  }
})

/* ---------------------------------------------------------------- JSON merge */

const current = {
  version: 1,
  workspaces: [{ id: 'ws-a', name: 'Local', icon: 'book', createdAt: stamp, updatedAt: stamp }],
  nodes: [node('doc-a', 'ws-a', { media: [mediaItem('media-a')] })],
  settings: { autoSave: true },
  ui: { activeWorkspaceId: 'ws-a', activeNodeId: 'doc-a', expanded: [] },
  canvas: {
    items: [{ id: 'doc:doc-a', kind: 'doc', refId: 'doc-a', x: 10, y: 20, w: 300, h: 240, z: 0 }],
    links: [],
  },
  graph: { showTags: false, showLabels: true, scopeAll: false },
}

const incoming = () => ({
  workspaces: [{ id: 'ws-b', name: 'Imported', icon: 'book', createdAt: stamp, updatedAt: stamp }],
  nodes: [node('doc-b', 'ws-b'), node('doc-c', 'ws-b', { order: 1 })],
  canvas: {
    items: [
      { id: 'doc:doc-b', kind: 'doc', refId: 'doc-b', x: 400, y: 60, w: 320, h: 260, z: 0 },
      { id: 'doc:doc-c', kind: 'doc', refId: 'doc-c', x: 760, y: 60, w: 300, h: 240, z: 1 },
    ],
    links: [{ id: 'link:doc:doc-b::doc:doc-c', from: 'doc:doc-b', to: 'doc:doc-c' }],
  },
})

check('JSON merge keeps the target layout and adds the imported cards and link', () => {
  const merged = mergeSnapshot(current, incoming())
  assert.deepEqual(merged.canvas.items.map((item) => item.id), ['doc:doc-a', 'doc:doc-b', 'doc:doc-c'])
  assert.deepEqual([merged.canvas.items[1].x, merged.canvas.items[1].y, merged.canvas.items[1].w, merged.canvas.items[1].h], [400, 60, 320, 260])
  assert.equal(merged.canvas.links.length, 1)
  assert.equal(merged.canvas.links[0].id, 'link:doc:doc-b::doc:doc-c')
  assert.deepEqual(merged.graph, current.graph, 'target graph preferences win')
})

check('a colliding canvas card keeps the target geometry instead of duplicating', () => {
  const clash = incoming()
  clash.canvas.items[0] = { id: 'doc:doc-a', kind: 'doc', refId: 'doc-a', x: 999, y: 999, w: 500, h: 500, z: 5 }
  const merged = mergeSnapshot(current, clash)
  const cards = merged.canvas.items.filter((item) => item.id === 'doc:doc-a')
  assert.equal(cards.length, 1)
  assert.deepEqual([cards[0].x, cards[0].y], [10, 20], 'the local card is not moved by an import')
})

check('imported cards and links that point at nothing are dropped', () => {
  const broken = incoming()
  broken.canvas.items.push({ id: 'doc:ghost', kind: 'doc', refId: 'ghost', x: 0, y: 0, w: 300, h: 240, z: 9 })
  broken.canvas.items.push({ id: 'media:missing', kind: 'media', refId: 'missing', x: 0, y: 0, w: 300, h: 240, z: 9 })
  broken.nodes[1].media = [mediaItem('media-b')]
  broken.canvas.items.push({ id: 'media:media-b', kind: 'media', refId: 'media-b', x: 90, y: 420, w: 300, h: 240, z: 3 })
  broken.canvas.links.push({ id: 'link:doc:doc-b::doc:ghost', from: 'doc:doc-b', to: 'doc:ghost' })
  const merged = mergeSnapshot(current, broken)
  const ids = merged.canvas.items.map((item) => item.id)
  assert.ok(!ids.includes('doc:ghost'))
  assert.ok(!ids.includes('media:missing'))
  assert.ok(ids.includes('media:media-b'), 'a media card survives when its attachment came with a node')
  assert.equal(merged.canvas.links.length, 1, 'the dangling link is gone')
})

check('merging the same archive twice is idempotent', () => {
  const once = mergeSnapshot(current, incoming())
  const twice = mergeSnapshot(once, incoming())
  assert.deepEqual(twice.canvas, once.canvas)
  assert.deepEqual(twice.nodes.map((n) => n.id), once.nodes.map((n) => n.id))
})

check('a malformed imported canvas leaves the target canvas untouched', () => {
  for (const canvas of [undefined, null, 7, 'nope', { items: 'nope', links: {} }, { items: [null, { kind: 'doc' }], links: [null] }]) {
    const dirty = incoming()
    if (canvas === undefined) delete dirty.canvas
    else dirty.canvas = canvas
    const merged = mergeSnapshot(current, dirty)
    assert.deepEqual(merged.canvas, current.canvas, 'target canvas intact')
  }
})

check('merging into or from an empty canvas behaves like a plain append', () => {
  const emptyTarget = Object.assign({}, current, { canvas: { items: [], links: [] } })
  const merged = mergeSnapshot(emptyTarget, incoming())
  assert.equal(merged.canvas.items.length, 2)
  const noCanvas = incoming()
  delete noCanvas.canvas
  assert.deepEqual(mergeSnapshot(current, noCanvas).canvas, current.canvas)
})

if (process.exitCode === undefined) console.log('\ncanvas-import: ' + passed + ' checks passed')
