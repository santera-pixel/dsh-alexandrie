// End-to-end CRUD: drives the same store.commit + model mutators the UI calls, against a fake host.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const clientDir = path.join(here, '..', 'src', 'client')
const parts = fs
  .readdirSync(clientDir)
  .filter((name) => name.endsWith('.js'))
  .sort()
const source =
  parts.map((name) => fs.readFileSync(path.join(clientDir, name), 'utf8')).join('\n') +
  '\n;return { model, createStore }\n'

// ---------- fake host, mirroring lib/index.js ----------
const host = { revision: 0, snapshot: null, saves: 0 }
const envelope = (value) => ({ ok: true, status: 200, text: async () => JSON.stringify({ ok: true, value }) })
const fetchStub = async (url, options) => {
  const route = String(url).replace('/dsh-alexandrie', '')
  const method = (options && options.method) || 'GET'
  if (route === '/state' && method === 'GET') {
    return envelope({ version: 1, revision: host.revision, updatedAt: new Date().toISOString(), snapshot: host.snapshot })
  }
  if (route === '/health') return envelope({ directory: 'fake', file: 'data.json', exists: host.snapshot !== null, size: 1 })
  if (route === '/save' && method === 'POST') {
    const body = JSON.parse(options.body)
    host.revision += 1
    host.saves += 1
    host.snapshot = JSON.parse(JSON.stringify(body.snapshot))
    return envelope({ revision: host.revision, updatedAt: new Date().toISOString(), conflict: false })
  }
  return { ok: false, status: 404, text: async () => JSON.stringify({ ok: false, error: { message: 'unknown ' + route } }) }
}

const api = new Function('require', 'window', 'document', 'fetch', source)(
  (id) =>
    id === 'react'
      ? { createElement: () => null, useState: () => [null, () => {}], useRef: () => ({ current: null }), useEffect() {}, useMemo: (fn) => fn(), useCallback: (fn) => fn(), Component: class {} }
      : {},
  { addEventListener() {}, removeEventListener() {} },
  { head: { appendChild() {} }, createElement: () => ({ style: {} }) },
  fetchStub,
)

const results = []
const check = (name, fn) => {
  try {
    fn()
    results.push(['ok', name])
  } catch (error) {
    results.push(['fail', name + ' :: ' + error.message])
  }
}
const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const { model } = api
const store = api.createStore()
let crudId = null
const commit = (mutator) => store.commit(mutator)
const snap = () => store.state.snapshot
const workspaceId = () => model.workspacesOf(snap())[0].id

await store.load()

check('store seeded the archive on first run and persisted it', () => {
  assert(store.state.status === 'ready', 'status ' + store.state.status + ' ' + store.state.error)
  assert(store.state.snapshot !== null, 'snapshot missing')
  assert(model.workspacesOf(snap()).length === 1, 'expected 1 workspace')
  assert(model.aliveNodes(snap()).length >= 3, 'expected seeded docs')
})

check('create: document lands in the tree with the right parent and workspace', () => {
  commit((draft) => model.createNode(draft, { workspaceId: workspaceId(), parentId: null, kind: 'doc', title: 'CRUD doc', content: 'start' }))
  const node = model.aliveNodes(snap()).find((entry) => entry.title === 'CRUD doc')
  assert(node, 'document not created')
  assert(node.workspaceId === workspaceId(), 'wrong workspace')
  assert(node.status === 'draft', 'new documents start as draft, got ' + node.status)
  crudId = node.id
})

check('create: folder holds a nested document', () => {
  commit((draft) => model.createNode(draft, { workspaceId: workspaceId(), parentId: null, kind: 'folder', title: 'CRUD folder' }))
  const folder = model.aliveNodes(snap()).find((entry) => entry.title === 'CRUD folder')
  assert(folder && folder.kind === 'folder', 'folder not created')
  commit((draft) => model.createNode(draft, { workspaceId: workspaceId(), parentId: folder.id, kind: 'doc', title: 'Child doc' }))
  const child = model.childrenOf(snap(), workspaceId(), folder.id).find((entry) => entry.title === 'Child doc')
  assert(child, 'nested document not listed under the folder')
  const trail = model.nodeTrail(snap(), child.id).map((entry) => entry.title).join(' / ')
  assert(trail === 'CRUD folder / Child doc', 'trail ' + trail)
})

check('rename and content edits keep the document addressable', () => {
  commit((draft) => model.renameNode(draft, crudId, 'CRUD renamed'))
  commit((draft) => model.setContent(draft, crudId, '# Heading\n\nBody text'))
  const node = model.nodeById(snap(), crudId)
  assert(node.title === 'CRUD renamed', 'title ' + node.title)
  assert(node.content.includes('Body text'), 'content not saved')
})

check('move reparents the document and refuses an illegal cycle', () => {
  const folder = model.aliveNodes(snap()).find((entry) => entry.title === 'CRUD folder')
  commit((draft) => model.moveNode(draft, crudId, folder.id, workspaceId()))
  assert(model.nodeById(snap(), crudId).parentId === folder.id, 'document not reparented')
  assert(model.canReparent(snap(), folder.id, crudId) === false, 'folder must not move into its own child')
})

check('favourite, status and tags round-trip', () => {
  commit((draft) => model.toggleFavorite(draft, crudId))
  commit((draft) => model.setStatus(draft, crudId, 'done'))
  commit((draft) => model.addTag(draft, crudId, 'probe-tag'))
  const node = model.nodeById(snap(), crudId)
  assert(node.favorite === true, 'favourite not set')
  assert(node.status === 'done', 'status ' + node.status)
  assert(node.tags.includes('probe-tag'), 'tag missing')
  assert(model.collectTags(snap()).some((entry) => entry.tag === 'probe-tag' && entry.count === 1), 'tag cloud mismatch')
  commit((draft) => model.removeTag(draft, crudId, 'probe-tag'))
  assert(!model.nodeById(snap(), crudId).tags.includes('probe-tag'), 'tag not removed')
})

check('trash hides the whole subtree, restore brings it back, purge is final', () => {
  const folder = model.aliveNodes(snap()).find((entry) => entry.title === 'CRUD folder')
  const before = model.aliveNodes(snap()).length
  commit((draft) => model.trashNode(draft, folder.id))
  assert(model.trashedNodes(snap()).some((entry) => entry.id === folder.id), 'folder not in trash')
  assert(model.aliveNodes(snap()).length < before, 'subtree still alive')
  assert(model.childrenOf(snap(), folder.workspaceId, folder.id).length === 0, 'trashed children still listed')
  commit((draft) => model.restoreNode(draft, folder.id))
  assert(model.nodeById(snap(), folder.id).trashed === false, 'folder not restored')
  assert(model.aliveNodes(snap()).some((entry) => entry.title === 'Child doc'), 'child not restored with its parent')
  commit((draft) => model.trashNode(draft, folder.id))
  const ids = model.subtreeIds(snap(), folder.id)
  commit((draft) => model.purgeNode(draft, folder.id))
  for (const id of ids) assert(model.nodeById(snap(), id) === null, 'purge left ' + id)
})

check('workspace lifecycle: create, rename, delete cascades to its documents', () => {
  commit((draft) => model.createWorkspace(draft, 'Probe workspace'))
  const created = model.workspacesOf(snap()).find((entry) => entry.name === 'Probe workspace')
  assert(created, 'workspace not created')
  commit((draft) => model.renameWorkspace(draft, created.id, 'Probe renamed'))
  assert(model.workspaceById(snap(), created.id).name === 'Probe renamed', 'workspace not renamed')
  commit((draft) => model.createNode(draft, { workspaceId: created.id, parentId: null, kind: 'doc', title: 'Probe doc' }))
  commit((draft) => model.removeWorkspace(draft, created.id))
  assert(model.workspaceById(snap(), created.id) === null, 'workspace not removed')
  assert(!model.aliveNodes(snap()).some((entry) => entry.workspaceId === created.id), 'orphan documents left behind')
})

check('the final archive still satisfies the host validation rules', () => {
  const snapshot = snap()
  const seen = new Set()
  for (const node of snapshot.nodes) {
    assert(typeof node.id === 'string' && node.id !== '', 'node id must be a non-empty string')
    assert(!seen.has(node.id), 'duplicate node id ' + node.id)
    seen.add(node.id)
    if (node.content !== undefined) assert(typeof node.content === 'string', 'content must be a string')
    if (node.workspaceId) assert(snapshot.workspaces.some((entry) => entry.id === node.workspaceId), 'orphan node ' + node.id)
    if (node.parentId) assert(snapshot.nodes.some((entry) => entry.id === node.parentId), 'missing parent for ' + node.id)
  }
  assert(JSON.stringify(snapshot).length < 24 * 1024 * 1024, 'archive too large')
})

check('every commit reached the host save route', async () => {
  await store.saveNow()
  assert(host.saves >= 1, 'host never received a save')
  assert(host.snapshot.nodes.length === snap().nodes.length, 'persisted node count ' + host.snapshot.nodes.length + ' vs ' + snap().nodes.length)
})

store.dispose()

const failed = results.filter(([state]) => state === 'fail')
for (const [state, name] of results) console.log(state === 'ok' ? 'ok   ' + name : 'FAIL ' + name)
console.log(results.length - failed.length + '/' + results.length + ' CRUD checks passed')
if (failed.length > 0) process.exit(1)
