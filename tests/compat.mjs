// Persistence compatibility tests: what happens to an archive written before the
// canvas/graph blocks existed, when the current build loads and saves it.
//
// The point is to answer a concrete migration question with file bytes instead of
// reasoning: an old `data.json` must come back out with its documents untouched and
// only the two new default blocks appended.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { apply } from '../lib/index.js'

/* ------------------------------------------------------------------ client harness */

const here = path.dirname(fileURLToPath(import.meta.url))
const clientDir = path.join(here, '..', 'src', 'client')
const parts = fs
  .readdirSync(clientDir)
  .filter((name) => name.endsWith('.js'))
  .sort()

const source =
  parts.map((name) => fs.readFileSync(path.join(clientDir, name), 'utf8')).join('\n') +
  '\n;return { normalizeSnapshot, emptySnapshot }\n'

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

const client = new Function('require', 'window', 'document', 'fetch', source)(
  (id) => (id === 'react' ? react : {}),
  { addEventListener() {}, removeEventListener() {} },
  documentStub,
  async () => ({ ok: true, status: 200, text: async () => '{}', json: async () => ({}) }),
)

const { normalizeSnapshot } = client

/* ------------------------------------------------------------------ host harness */

const home = await mkdtemp(path.join(tmpdir(), 'scr-compat-'))
process.env.DSH_HOME = home
const routes = []
apply({
  webServer: {
    register(route) {
      routes.push(route)
      return () => {}
    },
  },
  effect() {
    return () => {}
  },
})
const route = routes[0]
const server = http.createServer((request, response) => {
  Promise.resolve(route.handler(request, response)).catch((error) => {
    response.writeHead(500)
    response.end(String(error))
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const { port } = server.address()

function request(pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body === undefined ? null : Buffer.isBuffer(options.body) ? options.body : Buffer.from(String(options.body))
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/dsh-scriptorium' + pathname,
        method: options.method || 'GET',
        headers: Object.assign({}, options.headers, body === null ? {} : { 'content-length': body.length }),
      },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          const raw = Buffer.concat(chunks)
          let json = null
          try {
            json = JSON.parse(raw.toString('utf8'))
          } catch {
            json = null
          }
          resolve({ status: res.statusCode, json })
        })
      },
    )
    req.on('error', reject)
    if (body !== null) req.write(body)
    req.end()
  })
}

const dataFile = path.join(home, 'scriptorium', 'data.json')
const readDisk = async () => JSON.parse(await readFile(dataFile, 'utf8'))

/**
 * Exactly what the client sends: the snapshot it holds in memory is the result of
 * loading the archive through normalizeSnapshot (plus, here, no user edits).
 */
async function saveSnapshot(snapshot) {
  const result = await request('/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ snapshot }),
  })
  assert.equal(result.status, 200, 'save accepted the snapshot')
  return readDisk()
}

/* ------------------------------------------------------- the archive from before */

const STAMP = '2026-01-01T00:00:00.000Z'
// Shape written by the build that predates snapshot.canvas / snapshot.graph. Every
// settings/ui key is present so "strip the new blocks" is an exact comparison.
const legacy = {
  version: 1,
  workspaces: [
    { id: 'ws-1', name: 'Docs HQ', icon: 'book', color: 'brand', createdAt: STAMP, updatedAt: STAMP },
  ],
  nodes: [
    {
      id: 'doc-1',
      workspaceId: 'ws-1',
      parentId: null,
      kind: 'doc',
      title: 'Welcome guide — ünïcode ✓',
      icon: 'sparkles',
      status: 'active',
      tags: ['intro', 'guide'],
      favorite: true,
      trashed: false,
      order: 0,
      createdAt: STAMP,
      updatedAt: STAMP,
      media: [{ id: 'media-1', name: 'diagram.png', mime: 'image/png', size: 5, uploadedAt: STAMP }],
      content: '# Welcome guide\n\nSee the **diagram**.\n\n- [x] ship it\n',
    },
    {
      id: 'folder-1',
      workspaceId: 'ws-1',
      parentId: null,
      kind: 'folder',
      title: 'Notes',
      icon: 'folder',
      order: 1,
      createdAt: STAMP,
      updatedAt: STAMP,
    },
    {
      id: 'doc-2',
      workspaceId: 'ws-1',
      parentId: 'folder-1',
      kind: 'doc',
      title: 'Nested note',
      icon: 'file',
      status: 'draft',
      tags: [],
      favorite: false,
      trashed: false,
      order: 1,
      createdAt: STAMP,
      updatedAt: STAMP,
      content: 'Nested body with "quotes" and \\ backslashes',
    },
    {
      id: 'doc-3',
      workspaceId: 'ws-1',
      parentId: null,
      kind: 'doc',
      title: 'Deleted draft',
      status: 'draft',
      tags: ['old'],
      favorite: false,
      trashed: true,
      order: 2,
      createdAt: STAMP,
      updatedAt: STAMP,
      content: 'still here in the trash',
    },
  ],
  settings: { view: 'list', editorMode: 'split', fontSize: 15, autoSave: true, showLineNumbers: true, sort: 'manual' },
  ui: { activeWorkspaceId: 'ws-1', activeNodeId: 'doc-1', expanded: ['folder-1'] },
}

const NEW_BLOCKS = ['canvas', 'graph']
const stripNewBlocks = (snapshot) => {
  const copy = {}
  for (const key of Object.keys(snapshot)) {
    if (NEW_BLOCKS.indexOf(key) < 0) copy[key] = snapshot[key]
  }
  return copy
}

let passed = 0
const failures = []
const check = async (name, fn) => {
  try {
    await fn()
    passed += 1
    console.log('ok   ' + name)
  } catch (error) {
    failures.push(name)
    console.error('FAIL ' + name)
    console.error(error && error.stack ? error.stack : error)
    process.exitCode = 1
  }
}

/* ------------------------------------------------------------------ the checks */

let firstWrite = null

await check('a pre-canvas archive loads with empty canvas and default graph prefs', async () => {
  const loaded = normalizeSnapshot(legacy)
  assert.deepEqual(loaded.canvas, { items: [], links: [] })
  assert.deepEqual(loaded.graph, { showTags: false, showLabels: true, scopeAll: false })
  assert.equal(loaded.version, 1)
})

await check('saving it writes the two default blocks and keeps every old field verbatim', async () => {
  firstWrite = await saveSnapshot(normalizeSnapshot(legacy))
  const stored = firstWrite.snapshot
  assert.equal(firstWrite.version, 1, 'store format version is unchanged')
  assert.equal(firstWrite.revision, 1, 'first save bumps the revision')
  assert.deepEqual(stored.canvas, { items: [], links: [] })
  assert.deepEqual(stored.graph, { showTags: false, showLabels: true, scopeAll: false })
  // Removing the two new blocks must give back the archive the old build wrote,
  // byte for byte (same key order, same values).
  assert.equal(JSON.stringify(stripNewBlocks(stored)), JSON.stringify(legacy), 'old data is untouched')
})

await check('the extra blocks cost well under a kilobyte', async () => {
  const withBlocks = Buffer.byteLength(JSON.stringify(firstWrite.snapshot))
  const withoutBlocks = Buffer.byteLength(JSON.stringify(legacy))
  const delta = withBlocks - withoutBlocks
  assert.ok(delta > 0, 'the blocks are actually written')
  assert.ok(delta < 1024, 'overhead is trivial (' + delta + ' bytes)')
  console.log('     overhead: ' + delta + ' bytes')
})

await check('loading and saving again is a fixed point (no drift between sessions)', async () => {
  const reloaded = await request('/state')
  assert.equal(reloaded.status, 200)
  const second = await saveSnapshot(normalizeSnapshot(reloaded.json.value.snapshot))
  assert.equal(
    JSON.stringify(second.snapshot),
    JSON.stringify(firstWrite.snapshot),
    'the persisted snapshot is identical on the second save',
  )
  assert.equal(second.revision, 2)
})

await check('used canvas data and changed graph prefs survive a reload', async () => {
  const loaded = normalizeSnapshot({
    workspaces: legacy.workspaces,
    nodes: legacy.nodes,
    settings: legacy.settings,
    ui: legacy.ui,
    canvas: {
      items: [
        { kind: 'doc', refId: 'doc-1', x: 120, y: 80, w: 320, h: 240 },
        { kind: 'media', refId: 'media-1', x: 120, y: 360, w: 300, h: 240 },
        { kind: 'doc', refId: 'doc-2', x: 480, y: 80, w: 320, h: 240 },
      ],
      links: [
        { from: 'doc:doc-1', to: 'doc:doc-2' },
        { from: 'doc:doc-1', to: 'media:media-1' },
      ],
    },
    graph: { showTags: true, showLabels: false, scopeAll: true },
  })
  const stored = await saveSnapshot(loaded)
  const back = normalizeSnapshot((await request('/state')).json.value.snapshot)
  assert.equal(back.canvas.items.length, 3, 'every card, including the attachment card, survives')
  assert.equal(back.canvas.links.length, 2, 'both links resolve to surviving cards')
  assert.deepEqual(back.canvas, stored.snapshot.canvas)
  assert.deepEqual(back.graph, { showTags: true, showLabels: false, scopeAll: true })
})

await check('a top-level block this build does not know about is not silently dropped', async () => {
  // Forward compatibility: a newer build (or a sibling feature) adds a block. This
  // build must carry it through load -> save instead of erasing it, otherwise the
  // same additive pattern that added canvas/graph would destroy future data.
  const future = {
    version: 1,
    workspaces: legacy.workspaces,
    nodes: legacy.nodes,
    settings: legacy.settings,
    ui: legacy.ui,
    futureBlock: { shape: 2, order: ['a', 'b'], nested: { keep: true } },
    legacyMetadata: 'keep me',
  }
  const loaded = normalizeSnapshot(future)
  assert.deepEqual(loaded.futureBlock, future.futureBlock, 'unknown block survives normalisation')
  assert.equal(loaded.legacyMetadata, 'keep me', 'unknown scalar survives normalisation')

  const stored = await saveSnapshot(loaded)
  assert.deepEqual(stored.snapshot.futureBlock, future.futureBlock, 'unknown block reaches the disk')
  const back = normalizeSnapshot((await request('/state')).json.value.snapshot)
  assert.deepEqual(back.futureBlock, future.futureBlock, 'unknown block survives a reload')
  assert.equal(back.legacyMetadata, 'keep me')
})

await check('an unknown block cannot rewrite the prototype of the snapshot', async () => {
  const raw = JSON.parse('{"workspaces":[],"nodes":[],"__proto__":{"polluted":true},"constructor":{"polluted":true}}')
  const loaded = normalizeSnapshot(raw)
  assert.equal(Object.getPrototypeOf(loaded), Object.prototype, 'result keeps Object.prototype')
  assert.equal(loaded.polluted, undefined, 'no prototype pollution')
  assert.deepEqual(loaded.canvas, { items: [], links: [] })
})

/* --------------------------------------------------- nested validation (host side) */

const hostBase = () => ({
  version: 1,
  workspaces: [{ id: 'ws-v', name: 'Valid' }],
  nodes: [{
    id: 'doc-v',
    workspaceId: 'ws-v',
    parentId: null,
    kind: 'doc',
    title: 'Valid',
    tags: ['ok'],
    media: [{ id: 'media-v', name: 'a.png', mime: 'image/png', size: 1, uploadedAt: STAMP }],
    content: '',
  }],
  settings: {},
  ui: {},
  canvas: { items: [], links: [] },
  graph: { showTags: false, showLabels: true, scopeAll: false },
})
const postSnapshot = (snapshot) => request('/save', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ snapshot }),
})

await check('nested tags, attachment ids, workspaces and duplicates are rejected with paths', async () => {
  const badTags = hostBase()
  badTags.nodes[0].tags = ['ok', 7]
  let result = await postSnapshot(badTags)
  assert.equal(result.status, 400)
  assert.match(result.json.error.message, /^nodes\[0\]\.tags\[1\]: must be a non-empty string/)

  const badMedia = hostBase()
  badMedia.nodes[0].media[0].id = ''
  result = await postSnapshot(badMedia)
  assert.equal(result.status, 400)
  assert.match(result.json.error.message, /^nodes\[0\]\.media\[0\]\.id: must be a non-empty string/)

  const duplicateMedia = hostBase()
  duplicateMedia.nodes[0].media.push({ id: 'media-v', name: 'b.png', mime: 'image/png', size: 2, uploadedAt: STAMP })
  result = await postSnapshot(duplicateMedia)
  assert.equal(result.status, 400)
  assert.match(result.json.error.message, /^nodes\[0\]\.media\[1\]\.id: duplicate attachment id "media-v"/)

  const strayNode = hostBase()
  strayNode.nodes[0].workspaceId = 'ws-ghost'
  result = await postSnapshot(strayNode)
  assert.equal(result.status, 400)
  assert.match(result.json.error.message, /^nodes\[0\]\.workspaceId: references missing workspace "ws-ghost"/)

  const duplicateWorkspace = hostBase()
  duplicateWorkspace.workspaces.push({ id: 'ws-v', name: 'Duplicate' })
  result = await postSnapshot(duplicateWorkspace)
  assert.equal(result.status, 400)
  assert.match(result.json.error.message, /^workspaces\[1\]\.id: duplicate workspace id "ws-v"/)
})

await check('canvas cards and link endpoints are resolved before persistence', async () => {
  const missingNode = hostBase()
  missingNode.canvas.items = [{ id: 'doc:ghost', kind: 'doc', refId: 'ghost', x: 0, y: 0, w: 300, h: 240, z: 0 }]
  let result = await postSnapshot(missingNode)
  assert.equal(result.status, 400)
  assert.match(result.json.error.message, /^canvas\.items\[0\]\.refId: references missing node "ghost"/)

  const missingMedia = hostBase()
  missingMedia.canvas.items = [{ id: 'media:ghost', kind: 'media', refId: 'ghost', x: 0, y: 0, w: 300, h: 240, z: 0 }]
  result = await postSnapshot(missingMedia)
  assert.equal(result.status, 400)
  assert.match(result.json.error.message, /^canvas\.items\[0\]\.refId: references missing attachment "ghost"/)

  const missingLink = hostBase()
  missingLink.canvas.items = [{ id: 'doc:doc-v', kind: 'doc', refId: 'doc-v', x: 0, y: 0, w: 300, h: 240, z: 0 }]
  missingLink.canvas.links = [{ id: 'link:doc:doc-v::doc:ghost', from: 'doc:doc-v', to: 'doc:ghost' }]
  result = await postSnapshot(missingLink)
  assert.equal(result.status, 400)
  assert.match(result.json.error.message, /^canvas\.links\[0\]\.to: references missing canvas item "doc:ghost"/)

  const wrongId = hostBase()
  wrongId.canvas.items = [{ id: 'card-1', kind: 'doc', refId: 'doc-v', x: 0, y: 0, w: 300, h: 240, z: 0 }]
  result = await postSnapshot(wrongId)
  assert.equal(result.status, 400)
  assert.match(result.json.error.message, /^canvas\.items\[0\]\.id: must be "doc:doc-v" for this doc card/)
})

await check('parent chains must resolve, stay inside one workspace and be acyclic', async () => {
  const dangling = hostBase()
  dangling.nodes[0].parentId = 'doc-ghost'
  let result = await postSnapshot(dangling)
  assert.equal(result.status, 400)
  assert.match(result.json.error.message, /^nodes\[0\]\.parentId: references missing node "doc-ghost"/)

  const cycle = hostBase()
  cycle.nodes[0].parentId = 'doc-w'
  cycle.nodes.push({ id: 'doc-w', workspaceId: 'ws-v', parentId: 'doc-v', kind: 'doc', title: 'Loop', tags: [], content: '' })
  result = await postSnapshot(cycle)
  assert.equal(result.status, 400)
  assert.match(result.json.error.message, /^nodes\[0\]\.parentId: creates a parent cycle/)

  const crossWorkspace = hostBase()
  crossWorkspace.workspaces.push({ id: 'ws-other', name: 'Other' })
  crossWorkspace.nodes.push({ id: 'doc-other', workspaceId: 'ws-other', parentId: null, kind: 'doc', title: 'Other', tags: [], content: '' })
  crossWorkspace.nodes[0].parentId = 'doc-other'
  result = await postSnapshot(crossWorkspace)
  assert.equal(result.status, 400)
  assert.match(result.json.error.message, /^nodes\[0\]\.parentId: parent node "doc-other" belongs to another workspace/)

  const workspaceCycle = hostBase()
  workspaceCycle.workspaces = [{ id: 'ws-a', parentId: 'ws-b', name: 'A' }, { id: 'ws-b', parentId: 'ws-a', name: 'B' }]
  result = await postSnapshot(workspaceCycle)
  assert.equal(result.status, 400)
  assert.match(result.json.error.message, /^workspaces\[0\]\.parentId: creates a parent cycle/)
})

await check('graph preferences reject unknown keys and non-boolean values with paths', async () => {
  const badType = hostBase()
  badType.graph.showTags = 'yes'
  let result = await postSnapshot(badType)
  assert.equal(result.status, 400)
  assert.match(result.json.error.message, /^graph\.showTags: must be a boolean/)

  const unknownKey = hostBase()
  unknownKey.graph.zoom = 2
  result = await postSnapshot(unknownKey)
  assert.equal(result.status, 400)
  assert.match(result.json.error.message, /^graph\.zoom: is not a known graph preference/)
})

await check('a snapshot from a newer build is rejected before it can be persisted', async () => {
  const before = JSON.stringify(await readDisk())
  const future = hostBase()
  future.version = 2
  let result = await postSnapshot(future)
  assert.equal(result.status, 400)
  assert.match(result.json.error.message, /^version: snapshot version 2 is newer than this build supports \(1\)/)

  const stringVersion = hostBase()
  stringVersion.version = '1'
  result = await postSnapshot(stringVersion)
  assert.equal(result.status, 400)
  assert.match(result.json.error.message, /^version: must be a non-negative integer/)
  assert.equal(JSON.stringify(await readDisk()), before, 'a rejected snapshot never reaches the disk')
})

await check('an older snapshot version runs the ordered migration before validation', async () => {
  const versionZero = {
    version: 0,
    workspaces: [{ id: 'ws-v', name: 'Valid' }],
    nodes: [{ id: 'doc-v', workspaceId: 'ws-v', parentId: null, kind: 'doc', title: 'Old', tags: [], content: '' }],
    settings: {},
    ui: {},
    futureBlock: { keep: true },
  }
  const stored = await saveSnapshot(versionZero)
  assert.equal(stored.snapshot.version, 1, 'version 0 migrates to 1')
  assert.deepEqual(stored.snapshot.canvas, { items: [], links: [] })
  assert.deepEqual(stored.snapshot.graph, { showTags: false, showLabels: true, scopeAll: false })
  assert.deepEqual(stored.snapshot.futureBlock, { keep: true }, 'unknown blocks survive the migration')
})

server.close()
await rm(home, { recursive: true, force: true })
if (failures.length > 0) {
  console.error('\ncompat: ' + passed + ' passed, ' + failures.length + ' failed: ' + failures.join('; '))
} else {
  console.log('\ncompat: ' + passed + ' checks passed')
}
