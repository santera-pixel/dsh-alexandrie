// Downgrade safety: a pre-canvas build rebuilds the snapshot from a fixed key list, so
// opening a newer archive there and saving drops `canvas` and `graph`. Those builds are
// already shipped and cannot be patched, so this test drives the real host half over HTTP
// and proves that the newer side keeps its own copy of the layout and merges it back.
//
// The downgrade is simulated with the exact behaviour of the old normalizer: a snapshot
// with only version/workspaces/nodes/settings/ui written straight to data.json.

import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'

let passed = 0
const pending = []
const check = (title, fn) => {
  pending.push(async () => {
    try {
      await fn()
      passed += 1
      console.log('ok   ' + title)
    } catch (error) {
      console.error('FAIL ' + title)
      console.error(error && error.stack ? error.stack : error)
      process.exitCode = 1
    }
  })
}

const home = await mkdtemp(join(tmpdir(), 'axl-downgrade-'))
process.env.DSH_HOME = home
const storeDir = join(home, 'alexandrie')
const dataFile = join(storeDir, 'data.json')
await mkdir(storeDir, { recursive: true })

const routes = []
const ctx = {
  webServer: {
    register(route) {
      routes.push(route)
      return () => {}
    },
  },
  effect() {
    return () => {}
  },
}
apply(ctx)
assert.equal(routes.length, 1, 'host half registers exactly one prefix route')

const server = http.createServer((request, response) => {
  Promise.resolve(routes[0].handler(request, response)).catch((error) => {
    response.writeHead(500)
    response.end(String(error))
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const { port } = server.address()

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body === undefined ? null : Buffer.from(String(options.body))
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/dsh-alexandrie' + path,
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
          resolve({ status: res.statusCode, headers: res.headers, raw, json })
        })
      },
    )
    req.on('error', reject)
    if (body !== null) req.write(body)
    req.end()
  })
}

const stamp = '2026-01-01T00:00:00.000Z'
const mediaEntry = { id: 'media-1', name: 'shot.png', mime: 'image/png', size: 4, uploadedAt: stamp }
const doc = (id, title, extra = {}) => Object.assign(
  {
    id,
    workspaceId: 'ws-1',
    parentId: null,
    kind: 'doc',
    title,
    status: 'active',
    tags: [],
    favorite: false,
    trashed: false,
    order: 0,
    createdAt: stamp,
    updatedAt: stamp,
    content: '# ' + title,
  },
  extra,
)

const layout = () => ({
  items: [
    { id: 'doc:doc-1', kind: 'doc', refId: 'doc-1', x: 120, y: 60, w: 320, h: 260, z: 0 },
    { id: 'media:media-1', kind: 'media', refId: 'media-1', x: 520, y: 240, w: 300, h: 240, z: 1 },
    { id: 'doc:doc-2', kind: 'doc', refId: 'doc-2', x: 900, y: 90, w: 260, h: 200, z: 2 },
  ],
  links: [
    { id: 'link:doc:doc-1::media:media-1', from: 'doc:doc-1', to: 'media:media-1' },
    { id: 'link:doc:doc-1::doc:doc-2', from: 'doc:doc-1', to: 'doc:doc-2' },
  ],
})

const graph = { showTags: true, showLabels: false, scopeAll: true }

/** What survives once doc-2 is deleted in the old build: its card and link are pruned. */
const prunedLayout = () => ({
  items: layout().items.filter((item) => item.id !== 'doc:doc-2'),
  links: layout().links.filter((link) => link.to !== 'doc:doc-2'),
})

const makeSnapshot = () => ({
  version: 1,
  workspaces: [{ id: 'ws-1', name: 'Studio', icon: 'book', createdAt: stamp, updatedAt: stamp }],
  nodes: [
    doc('doc-1', 'Moodboard', { media: [mediaEntry], content: '![shot](media-1)' }),
    doc('doc-2', 'Second board', { order: 1 }),
  ],
  settings: { autoSave: true, editorMode: 'split' },
  ui: { activeWorkspaceId: 'ws-1', activeNodeId: 'doc-1', expanded: [] },
  canvas: layout(),
  graph,
})

async function writeStore(snapshot, revision = 1) {
  await writeFile(dataFile, JSON.stringify({ version: 1, revision, updatedAt: stamp, snapshot }), 'utf8')
}

/** Exactly what a pre-canvas build writes: a snapshot rebuilt from its fixed key list. */
async function downgradeEdit(mutate) {
  const stored = JSON.parse(await readFile(dataFile, 'utf8'))
  const source = stored.snapshot
  const rebuilt = {
    version: 1,
    workspaces: source.workspaces,
    nodes: source.nodes,
    settings: source.settings,
    ui: source.ui,
  }
  if (typeof mutate === 'function') mutate(rebuilt)
  await writeStore(rebuilt, stored.revision + 1)
  assert.equal(rebuilt.canvas, undefined, 'the simulated old build really dropped the layout')
}

const getState = async () => {
  const result = await request('/state')
  assert.equal(result.status, 200)
  assert.equal(result.json.ok, true)
  return result.json.value
}

const canvasOf = (snapshot) => snapshot && snapshot.canvas ? snapshot.canvas : null

async function sidecarExists() {
  for (const name of ['layout.json', 'canvas.json', 'canvas-backup.json']) {
    try {
      const info = await stat(join(storeDir, name))
      if (info.isFile() && info.size > 0) return name
    } catch {
      // try the next candidate
    }
  }
  return null
}

await writeStore(makeSnapshot(), 1)

/* --------------------------------------------------------------------- checks */

check('the first read of an existing archive starts protecting its layout', async () => {
  const state = await getState()
  assert.deepEqual(canvasOf(state.snapshot), layout(), 'the served snapshot keeps its layout')
  assert.notEqual(await sidecarExists(), null, 'a layout copy now exists on disk')
})

check('an old build stripping the snapshot cannot destroy positions, sizes or links', async () => {
  await downgradeEdit()
  const state = await getState()
  assert.deepEqual(canvasOf(state.snapshot), layout(), 'the full layout comes back')
  assert.deepEqual(state.snapshot.graph, graph, 'graph preferences come back too')
  const persisted = JSON.parse(await readFile(dataFile, 'utf8'))
  assert.equal(persisted.snapshot.canvas, undefined, 'recovery is served, it does not have to rewrite the archive')
})

check('document work done during the downgrade survives the restore', async () => {
  await downgradeEdit((rebuilt) => {
    rebuilt.nodes[0].title = 'Moodboard edited in the old build'
    rebuilt.nodes[0].content = '# Edited during downgrade'
    rebuilt.nodes.push(doc('doc-3', 'Written while downgraded', { order: 2 }))
    rebuilt.nodes = rebuilt.nodes.filter((node) => node.id !== 'doc-2')
  })
  const state = await getState()
  assert.equal(state.snapshot.nodes.find((node) => node.id === 'doc-1').title, 'Moodboard edited in the old build')
  assert.equal(state.snapshot.nodes.find((node) => node.id === 'doc-1').content, '# Edited during downgrade')
  assert.ok(state.snapshot.nodes.some((node) => node.id === 'doc-3'), 'the new document survives')
  const canvas = canvasOf(state.snapshot)
  assert.ok(canvas.items.some((item) => item.id === 'doc:doc-1'), 'cards for surviving documents stay')
  assert.ok(!canvas.items.some((item) => item.id === 'doc:doc-2'), 'a card whose document was deleted is pruned')
  assert.ok(!canvas.links.some((link) => link.to === 'doc:doc-2'), 'links to a pruned card disappear')
  assert.deepEqual(
    canvas.items.map((item) => [item.id, item.x, item.y, item.w, item.h]),
    [
      ['doc:doc-1', 120, 60, 320, 260],
      ['media:media-1', 520, 240, 300, 240],
    ],
    'surviving cards keep their exact geometry',
  )
})

check('recovery is idempotent: repeated loads and downgrade cycles do not drift', async () => {
  const first = await getState()
  const second = await getState()
  assert.deepEqual(second.snapshot.canvas, first.snapshot.canvas)
  assert.equal(second.revision, first.revision, 'reading does not bump the revision')
  const signature = (state) => JSON.stringify(state.snapshot.canvas)
  const before = signature(first)
  for (let cycle = 0; cycle < 2; cycle += 1) {
    await downgradeEdit()
    const restored = await getState()
    assert.equal(signature(restored), before, 'cycle ' + (cycle + 1) + ' restores the same layout')
    assert.equal(restored.revision, first.revision + cycle + 1, 'the downgrade bumps the revision, the read does not')
    assert.equal(new Set(restored.snapshot.canvas.items.map((item) => item.id)).size, restored.snapshot.canvas.items.length, 'no duplicate cards')
    assert.equal(new Set(restored.snapshot.canvas.links.map((link) => link.id)).size, restored.snapshot.canvas.links.length, 'no duplicate links')
  }
})

check('a save after recovery persists the layout and survives the next downgrade', async () => {
  const restored = await getState()
  const saved = await request('/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ snapshot: restored.snapshot }),
  })
  assert.equal(saved.status, 200)
  const persisted = JSON.parse(await readFile(dataFile, 'utf8'))
  assert.deepEqual(persisted.snapshot.canvas, restored.snapshot.canvas, 'the archive itself carries the layout again')
  await downgradeEdit()
  const again = await getState()
  assert.deepEqual(again.snapshot.canvas, restored.snapshot.canvas, 'the next downgrade is recovered too')
})

check('JSON export carries the recovered layout, not the stripped archive', async () => {
  await downgradeEdit()
  const exported = await request('/export')
  assert.equal(exported.status, 200)
  const snapshot = JSON.parse(exported.raw.toString('utf8'))
  assert.deepEqual(snapshot.canvas, prunedLayout(), 'exported archive includes the layout')
})

check('a corrupt layout copy cannot break state reads, and the next save repairs it', async () => {
  const sidecar = await sidecarExists()
  assert.notEqual(sidecar, null)
  await writeFile(join(storeDir, sidecar), '{ not json', 'utf8')
  const state = await getState()
  assert.equal(state.snapshot.nodes.length, 2)
  const exported = await request('/export')
  assert.equal(exported.status, 200, 'export still works without a readable layout copy')
  // A normal save from the UI rewrites the copy, so the next downgrade is protected again.
  const repaired = Object.assign({}, state.snapshot, { canvas: prunedLayout(), graph })
  const saved = await request('/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ snapshot: repaired }) })
  assert.equal(saved.status, 200)
  await downgradeEdit()
  const again = await getState()
  assert.deepEqual(canvasOf(again.snapshot), prunedLayout(), 'the repaired copy protects the next downgrade')
})

for (const run of pending) await run()

server.close()
await rm(home, { recursive: true, force: true })
if (process.exitCode === undefined) console.log('\ndowngrade: ' + passed + ' checks passed')
