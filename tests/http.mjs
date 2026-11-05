// Host route tests: mounts the real host half on a throwaway HTTP server, so every route
// (state/save, media upload/download, ZIP export/import) is exercised end to end without
// touching the running Harness.

import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'
import { buildArchive } from '../lib/archive.js'
import { parseZip } from '../lib/zip.js'

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

const home = await mkdtemp(join(tmpdir(), 'scr-http-'))
process.env.DSH_HOME = home

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
const route = routes[0]
assert.equal(route.kind, 'prefix')
assert.equal(route.path, '/dsh-scriptorium')

const server = http.createServer((request, response) => {
  Promise.resolve(route.handler(request, response)).catch((error) => {
    response.writeHead(500)
    response.end(String(error))
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const { port } = server.address()

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body === undefined ? null : Buffer.isBuffer(options.body) ? options.body : Buffer.from(String(options.body))
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/dsh-scriptorium' + path,
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

const snapshot = {
  version: 1,
  workspaces: [{ id: 'ws-1', name: 'Docs HQ', icon: 'book', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
  nodes: [
    {
      id: 'doc-1',
      workspaceId: 'ws-1',
      parentId: null,
      kind: 'doc',
      title: 'Welcome guide',
      status: 'active',
      tags: ['intro'],
      favorite: false,
      trashed: false,
      order: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      content: '# Welcome\n\nBody with <script>alert(1)</script>',
    },
    {
      id: 'doc-2',
      workspaceId: 'ws-1',
      parentId: null,
      kind: 'doc',
      title: 'Second note',
      status: 'draft',
      tags: [],
      favorite: false,
      trashed: false,
      order: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      content: 'Second body',
    },
  ],
  settings: { autoSave: true, editorMode: 'split' },
  ui: { activeWorkspaceId: 'ws-1', activeNodeId: 'doc-1', expanded: [] },
  // A board with two cards and one link. The layout must travel through the ZIP with
  // its geometry; dangling references are covered separately by a hand-built archive.
  canvas: {
    items: [
      { id: 'doc:doc-1', kind: 'doc', refId: 'doc-1', x: 80, y: 60, w: 320, h: 260, z: 0 },
      { id: 'doc:doc-2', kind: 'doc', refId: 'doc-2', x: 520, y: 60, w: 300, h: 240, z: 1 },
    ],
    links: [
      { id: 'link:doc:doc-1::doc:doc-2', from: 'doc:doc-1', to: 'doc:doc-2' },
    ],
  },
  graph: { showTags: true, showLabels: true, scopeAll: false },
}

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
let savedMediaId = null
let archiveZip = null

check('health names the data file inside DSH_HOME', async () => {
  const result = await request('/health')
  assert.equal(result.status, 200)
  assert.equal(result.json.ok, true)
  assert.ok(result.json.value.file.startsWith(home), 'file lives under the temp DSH_HOME')
  assert.match(result.json.value.file, /scriptorium[\\/]data\.json$/)
})

check('projects are mirrored from storages/workspace.json, read-only and degradable', async () => {
  const storages = join(home, 'storages')
  await mkdir(storages, { recursive: true })
  const projectsFile = join(storages, 'workspace.json')
  await writeFile(
    projectsFile,
    JSON.stringify({
      global: { defaultWorkspaceId: 'p-2', workspaceIds: ['p-1', 'p-2', 'p-ghost'] },
      tables: { workspaces: { 'p-1': { path: 'C:\\a', title: 'Alpha' }, 'p-2': { path: 'C:\\b' }, 'p-ghost': null } },
    }),
  )
  const result = await request('/projects')
  assert.equal(result.status, 200)
  assert.equal(result.json.ok, true)
  assert.equal(result.json.value.exists, true)
  assert.equal(result.json.value.defaultProjectId, 'p-2')
  assert.deepEqual(result.json.value.projects.map((project) => project.title), ['Alpha', 'b'])
  assert.deepEqual(result.json.value.projects.map((project) => project.id), ['p-1', 'p-2'])
  assert.match(result.json.value.source, /storages[\\/]workspace\.json$/)

  await writeFile(projectsFile, '{ not json')
  const broken = await request('/projects')
  assert.equal(broken.status, 200)
  assert.equal(broken.json.value.projects.length, 0)
  assert.match(broken.json.value.warning, /not valid JSON/)

  const wrongMethod = await request('/projects', { method: 'POST' })
  assert.equal(wrongMethod.status, 405)
  await rm(storages, { recursive: true, force: true })
})

check('state on a fresh home reports a null snapshot', async () => {
  const result = await request('/state')
  assert.equal(result.status, 200)
  assert.equal(result.json.value.snapshot, null)
})

check('save persists the snapshot verbatim and bumps the revision', async () => {
  const result = await request('/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ snapshot }) })
  assert.equal(result.status, 200)
  assert.equal(result.json.value.revision, 1)
  const state = await request('/state')
  assert.equal(state.json.value.revision, 1)
  assert.match(state.json.value.snapshot.nodes[0].content, /<script>alert\(1\)<\/script>/)
})

check('settings survive the save/state round-trip', async () => {
  const state = await request('/state')
  assert.equal(state.json.value.snapshot.settings.editorMode, 'split')
  assert.equal(state.json.value.snapshot.settings.autoSave, true)
})

check('an invalid snapshot is rejected with 400 and a message', async () => {
  const result = await request('/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ snapshot: { nodes: [] } }) })
  assert.equal(result.status, 400)
  assert.equal(result.json.ok, false)
  assert.match(result.json.error.message, /workspaces/)
})

check('a changed setting is persisted by the next save', async () => {
  const changed = JSON.parse(JSON.stringify(snapshot))
  changed.settings.editorMode = 'write'
  changed.settings.fontSize = 17
  const saved = await request('/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ snapshot: changed }) })
  assert.equal(saved.status, 200)
  const state = await request('/state')
  assert.equal(state.json.value.snapshot.settings.editorMode, 'write')
  assert.equal(state.json.value.snapshot.settings.fontSize, 17)
})

check('media upload stores the bytes, metadata and size', async () => {
  const result = await request('/media', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'diagram.png', mime: 'image/png', dataBase64: png.toString('base64') }),
  })
  assert.equal(result.status, 200)
  const entry = result.json.value
  assert.equal(entry.name, 'diagram.png')
  assert.equal(entry.mime, 'image/png')
  assert.equal(entry.size, png.length)
  savedMediaId = entry.id
})

check('media download returns the exact bytes inline, and as an attachment with ?download=1', async () => {
  const inline = await request('/media/' + savedMediaId)
  assert.equal(inline.status, 200)
  assert.equal(inline.headers['content-type'], 'image/png')
  assert.match(String(inline.headers['content-disposition']), /^inline/)
  assert.deepEqual([...inline.raw], [...png])
  const attachment = await request('/media/' + savedMediaId + '?download=1')
  assert.match(String(attachment.headers['content-disposition']), /^attachment/)
})

check('the media index lists the attachment and its total size', async () => {
  const result = await request('/media')
  assert.equal(result.status, 200)
  assert.equal(result.json.value.entries.length, 1)
  assert.equal(result.json.value.total, png.length)
  assert.ok(result.json.value.directory.startsWith(home))
})

check('ZIP export streams a readable archive with manifest, note and media', async () => {
  const result = await request('/archive/export')
  assert.equal(result.status, 200)
  assert.equal(result.headers['content-type'], 'application/zip')
  assert.match(String(result.headers['content-disposition']), /attachment; filename="scriptorium-/)
  assert.equal(result.raw.subarray(0, 2).toString('latin1'), 'PK')
  const names = parseZip(result.raw).map((entry) => entry.name)
  assert.ok(names.includes('manifest.json'))
  assert.ok(names.some((name) => name.startsWith('notes/')))
  assert.ok(names.some((name) => name.startsWith('media/')))
  const manifest = JSON.parse(parseZip(result.raw).find((entry) => entry.name === 'manifest.json').data.toString('utf8'))
  assert.equal(manifest.snapshot.canvas.items.length, 2, 'the exported archive carries the board')
  assert.deepEqual(manifest.snapshot.graph, snapshot.graph)
  archiveZip = result.raw
})

check('ZIP import remaps the archive and stores its media', async () => {
  const before = await request('/media')
  const result = await request('/archive/import', { method: 'POST', headers: { 'content-type': 'application/zip' }, body: archiveZip })
  assert.equal(result.status, 200)
  const value = result.json.value
  assert.ok(value.snapshot.nodes.length >= 1)
  assert.ok(!value.snapshot.nodes.some((node) => node.id === 'doc-1'), 'imported ids are remapped')
  assert.equal(value.notes, 2)
  assert.equal(value.media.length, 1)
  const after = await request('/media')
  assert.equal(after.json.value.entries.length, before.json.value.entries.length + 1)
})

check('ZIP import carries the board onto the remapped ids', async () => {
  const result = await request('/archive/import', { method: 'POST', headers: { 'content-type': 'application/zip' }, body: archiveZip })
  const value = result.json.value
  const canvas = value.snapshot.canvas
  assert.ok(canvas && Array.isArray(canvas.items) && Array.isArray(canvas.links), 'imported snapshot has a canvas')
  assert.equal(canvas.items.length, 2, 'both cards survive')
  const docIds = new Set(value.snapshot.nodes.map((node) => node.id))
  const cardIds = new Set(canvas.items.map((item) => item.id))
  for (const item of canvas.items) {
    assert.ok(docIds.has(item.refId), 'every card points at a document that was imported')
    assert.equal(item.id, item.kind + ':' + item.refId)
  }
  const welcome = value.snapshot.nodes.find((node) => node.title === 'Welcome guide')
  const card = canvas.items.find((item) => item.refId === welcome.id)
  assert.deepEqual([card.x, card.y, card.w, card.h], [80, 60, 320, 260], 'geometry survives the round-trip')
  assert.equal(canvas.links.length, 1)
  const link = canvas.links[0]
  assert.ok(cardIds.has(link.from) && cardIds.has(link.to), 'link endpoints are imported cards')
  assert.equal(link.id, 'link:' + [link.from, link.to].sort().join('::'))
  assert.deepEqual(value.snapshot.graph, snapshot.graph, 'graph preferences travel with the archive')
})

check('ZIP import prunes dangling canvas references before accepting the archive', async () => {
  // remapSnapshot drops references to nodes/attachments that did not survive the
  // import; the host validates the pruned result rather than rejecting the archive.
  const dirty = JSON.parse(JSON.stringify(snapshot))
  dirty.canvas.items.push({ id: 'media:missing', kind: 'media', refId: 'missing', x: 0, y: 0, w: 300, h: 240, z: 2 })
  dirty.canvas.links.push({ id: 'link:doc:doc-1::media:missing', from: 'doc:doc-1', to: 'media:missing' })
  const zip = buildArchive({ snapshot: dirty, media: [] })
  const result = await request('/archive/import', { method: 'POST', headers: { 'content-type': 'application/zip' }, body: zip })
  assert.equal(result.status, 200)
  assert.equal(result.json.value.snapshot.canvas.items.length, 2, 'the missing-attachment card is dropped')
  assert.equal(result.json.value.snapshot.canvas.links.length, 1, 'the dangling link is dropped')
})

check('a broken ZIP body answers 400 instead of crashing the route', async () => {
  const result = await request('/archive/import', { method: 'POST', headers: { 'content-type': 'application/zip' }, body: Buffer.from('not a zip at all') })
  assert.equal(result.status, 400)
  assert.equal(result.json.ok, false)
  assert.match(result.json.error.message, /ZIP/)
})

check('media can be deleted, after which it 404s', async () => {
  const removed = await request('/media/' + savedMediaId, { method: 'DELETE' })
  assert.equal(removed.status, 200)
  assert.equal(removed.json.value.removed, true)
  const missing = await request('/media/' + savedMediaId)
  assert.equal(missing.status, 404)
  assert.equal(missing.json.ok, false)
})

check('unknown routes still answer 404 in the envelope shape', async () => {
  const result = await request('/nope')
  assert.equal(result.status, 404)
  assert.equal(result.json.ok, false)
})

check('media paths reject ids that are not plain identifiers', async () => {
  const result = await request('/media/..%2F..%2Fdata.json')
  assert.equal(result.status, 400)
  assert.equal(result.json.ok, false)
})

/* ---------------------------------------------------------------------------------
   Nested snapshot validation (schema-validation card). The route must answer 400 with
   a message that starts at the exact offending path, never persist a half-valid board
   and never crash on a hostile reference.
   --------------------------------------------------------------------------------- */
const validSnapshot = () => JSON.parse(JSON.stringify({
  version: 1,
  workspaces: [{ id: 'ws-v', name: 'Valid' }],
  nodes: [{
    id: 'doc-v',
    workspaceId: 'ws-v',
    parentId: null,
    kind: 'doc',
    title: 'Valid',
    tags: ['ok'],
    media: [{ id: 'media-v', name: 'a.png', mime: 'image/png', size: 1, uploadedAt: '2026-01-01T00:00:00.000Z' }],
    content: '',
  }],
  settings: {},
  ui: {},
  canvas: { items: [], links: [] },
  graph: { showTags: false, showLabels: true, scopeAll: false },
}))
const saveRaw = (snapshot) => request('/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ snapshot }) })

check('nested validation names the offending tag and attachment paths', async () => {
  const badTag = validSnapshot()
  badTag.nodes[0].tags = ['ok', 7]
  const tagResult = await saveRaw(badTag)
  assert.equal(tagResult.status, 400)
  assert.match(tagResult.json.error.message, /^nodes\[0\]\.tags\[1\]: must be a non-empty string/)

  const badMedia = validSnapshot()
  badMedia.nodes[0].media[0].id = ''
  const mediaResult = await saveRaw(badMedia)
  assert.equal(mediaResult.status, 400)
  assert.match(mediaResult.json.error.message, /^nodes\[0\]\.media\[0\]\.id:/)
})

check('canvas cards and links must resolve to stored nodes and attachments', async () => {
  const badCard = validSnapshot()
  badCard.canvas.items = [{ id: 'media:ghost', kind: 'media', refId: 'ghost', x: 0, y: 0, w: 300, h: 240, z: 0 }]
  const cardResult = await saveRaw(badCard)
  assert.equal(cardResult.status, 400)
  assert.match(cardResult.json.error.message, /^canvas\.items\[0\]\.refId: references missing attachment "ghost"/)

  const badLink = validSnapshot()
  badLink.canvas.items = [{ id: 'doc:doc-v', kind: 'doc', refId: 'doc-v', x: 0, y: 0, w: 300, h: 240, z: 0 }]
  badLink.canvas.links = [{ id: 'link:doc:doc-v::doc:ghost', from: 'doc:doc-v', to: 'doc:ghost' }]
  const linkResult = await saveRaw(badLink)
  assert.equal(linkResult.status, 400)
  assert.match(linkResult.json.error.message, /^canvas\.links\[0\]\.to: references missing canvas item "doc:ghost"/)
})

check('a node must belong to a workspace and graph prefs are typed', async () => {
  const strayNode = validSnapshot()
  strayNode.nodes[0].workspaceId = 'ws-ghost'
  const nodeResult = await saveRaw(strayNode)
  assert.equal(nodeResult.status, 400)
  assert.match(nodeResult.json.error.message, /^nodes\[0\]\.workspaceId: references missing workspace "ws-ghost"/)

  const badGraph = validSnapshot()
  badGraph.graph.showTags = 'yes'
  const graphResult = await saveRaw(badGraph)
  assert.equal(graphResult.status, 400)
  assert.match(graphResult.json.error.message, /^graph\.showTags: must be a boolean/)
})

check('a snapshot version newer than this build is rejected with version in the path', async () => {
  const future = validSnapshot()
  future.version = 2
  const result = await saveRaw(future)
  assert.equal(result.status, 400)
  assert.match(result.json.error.message, /^version: snapshot version 2 is newer than this build supports/)
})

check('a ZIP import from a newer build is rejected before remapping downgrades it', async () => {
  const future = JSON.parse(JSON.stringify(snapshot))
  future.version = 2
  const zip = buildArchive({ snapshot: future, media: [] })
  const result = await request('/archive/import', { method: 'POST', headers: { 'content-type': 'application/zip' }, body: zip })
  assert.equal(result.status, 400)
  assert.match(result.json.error.message, /^version: snapshot version 2 is newer than this build supports/)
})

for (const run of pending) await run()

server.close()
await rm(home, { recursive: true, force: true })
if (process.exitCode === undefined) console.log('\nhttp: ' + passed + ' checks passed')
