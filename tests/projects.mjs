// Project mirror behaviour: every notebook is bound to one Harness project.
// The client parts are plain scripts, so one function wrapper exercises exactly
// the model and store code the panel runs.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const clientDir = path.join(here, '..', 'src', 'client')
const read = (name) => fs.readFileSync(path.join(clientDir, name), 'utf8')

let passed = 0
const failures = []
const pending = []
const check = (name, fn) => {
  pending.push(async () => {
    try {
      const result = await fn()
      if (result === false) throw new Error('returned false')
      passed += 1
      console.log('ok   ' + name)
    } catch (error) {
      failures.push(name + ' :: ' + (error && error.message ? error.message : String(error)))
      console.error('FAIL ' + name)
      console.error('     ' + (error && error.message ? error.message : String(error)))
    }
  })
}
const eq = (actual, expected, label) => {
  if (actual !== expected) throw new Error((label || 'value') + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual))
}
const ok = (value, label) => {
  if (!value) throw new Error(label || 'expected a truthy value')
}

const harness = `
return { model, emptySnapshot, normalizeSnapshot, seedSnapshot, createStore }
`

const source = ['00-boot.js', '05-model.js', '10-store.js'].map(read).join('\n').concat('\n', harness)
const reactShim = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useMemo: (factory) => factory(),
  useRef: (initial) => ({ current: initial }),
  Fragment: 'Fragment',
}

function loadClient(fetchImpl) {
  const factory = new Function('require', 'window', 'document', 'fetch', source)
  return factory(
    (id) => (id === 'react' ? reactShim : {}),
    { setTimeout: () => {}, clearTimeout: () => {}, addEventListener: () => {} },
    { createElement: () => ({ click() {} }), body: { appendChild() {}, removeChild() {} } },
    fetchImpl,
  )
}

const fetchFor = (handlers) => async (url, init) => {
  const key = String(url).replace('/dsh-alexandrie', '') + ' ' + ((init && init.method) || 'GET')
  const handler = handlers[key]
  if (!handler) throw new Error('unexpected request: ' + key)
  const payload = handler(init && init.body ? JSON.parse(init.body) : null)
  const body = JSON.stringify({ ok: true, value: payload })
  return { ok: true, status: 200, text: async () => body }
}

const api = loadClient(fetchFor({}))

const stamp = '2026-01-01T00:00:00.000Z'
const baseSnapshot = () => {
  const snapshot = api.emptySnapshot()
  snapshot.workspaces = [{ id: 'ws-legacy', name: 'My knowledge base', icon: 'book', color: 'brand', createdAt: stamp, updatedAt: stamp }]
  snapshot.nodes = [
    { id: 'doc-legacy', workspaceId: 'ws-legacy', parentId: null, kind: 'doc', title: 'Legacy note', status: 'draft', tags: [], favorite: false, trashed: false, order: 0, createdAt: stamp, updatedAt: stamp, content: 'keep me' },
  ]
  snapshot.ui.activeWorkspaceId = 'ws-legacy'
  snapshot.ui.activeNodeId = 'doc-legacy'
  return snapshot
}

const projectA = { id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', title: 'LivingMiniature', path: 'C:\\work\\LivingMiniature' }
const projectB = { id: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', title: 'BlackHoleT', path: 'C:\\work\\BlackHoleT' }

check('one notebook is created per project, bound by project id and path', () => {
  const snapshot = baseSnapshot()
  const summary = api.model.syncProjects(snapshot, [projectA, projectB], projectA.id)
  eq(snapshot.workspaces.length, 2, 'workspace count')
  eq(summary.created, 1, 'created the non-default project notebook')
  eq(summary.linked, 1, 'legacy notebook adopted by the default project')
  eq(summary.changed, true, 'changed')
  const bound = snapshot.workspaces.find((workspace) => workspace.projectId === projectB.id)
  ok(bound, 'project B notebook')
  eq(bound.name, projectB.title, 'name follows the project')
  eq(bound.path, projectB.path, 'path mirrors the project')
  eq(snapshot.ui.activeWorkspaceId, 'ws-legacy', 'the adopted notebook stays selected')
  eq(snapshot.nodes[0].workspaceId, 'ws-legacy', 'documents are never relocated by a plain sync')
  eq(snapshot.workspaces.filter((workspace) => workspace.projectId === projectA.id).length, 1, 'the legacy notebook was adopted')
  eq(snapshot.workspaces.find((workspace) => workspace.id === 'ws-legacy').projectId, projectA.id, 'legacy notebook now belongs to the default project')
})

check('a legacy single notebook is adopted into the default project and keeps its notes', () => {
  const snapshot = baseSnapshot()
  const summary = api.model.syncProjects(snapshot, [projectA, projectB], projectB.id)
  const adopted = snapshot.workspaces.find((workspace) => workspace.id === 'ws-legacy')
  ok(adopted, 'legacy workspace kept its id')
  eq(adopted.projectId, projectB.id, 'adopted by the default project')
  eq(summary.linked, 1, 'linked count')
  eq(snapshot.nodes[0].workspaceId, 'ws-legacy', 'note still points at its workspace')
})

check('sync is idempotent: a second pass changes nothing and never duplicates', () => {
  const snapshot = baseSnapshot()
  api.model.syncProjects(snapshot, [projectA, projectB], projectA.id)
  const before = snapshot.workspaces.map((workspace) => workspace.id).join(',')
  const summary = api.model.syncProjects(snapshot, [projectA, projectB], projectA.id)
  eq(summary.created, 0, 'created on second pass')
  eq(summary.changed, false, 'changed on second pass')
  eq(snapshot.workspaces.map((workspace) => workspace.id).join(','), before, 'workspace ids stay stable')
})

check('a project rename updates the notebook name but keeps its documents', () => {
  const snapshot = baseSnapshot()
  api.model.syncProjects(snapshot, [projectA], projectA.id)
  const renamed = Object.assign({}, projectA, { title: 'LivingMiniature 2.0' })
  const summary = api.model.syncProjects(snapshot, [renamed], projectA.id)
  eq(summary.updated, 1, 'updated')
  eq(snapshot.workspaces[0].name, 'LivingMiniature 2.0', 'new name')
})

check('a vanished project is flagged, never deleted, and can return', () => {
  const snapshot = baseSnapshot()
  api.model.syncProjects(snapshot, [projectA, projectB], projectA.id)
  const nodeCount = snapshot.nodes.length
  const summary = api.model.syncProjects(snapshot, [projectA], projectA.id)
  eq(summary.missing, 1, 'missing count')
  const orphan = snapshot.workspaces.find((workspace) => workspace.projectId === projectB.id)
  ok(orphan, 'notebook kept')
  eq(orphan.projectMissing, true, 'flagged')
  eq(snapshot.nodes.length, nodeCount, 'documents kept')
  api.model.syncProjects(snapshot, [projectA, projectB], projectA.id)
  eq(orphan.projectMissing, undefined, 'flag cleared when the project returns')
})

check('junk and duplicate project records are ignored safely', () => {
  const snapshot = baseSnapshot()
  const summary = api.model.syncProjects(
    snapshot,
    [projectA, projectA, null, { id: '' }, { id: '__proto__' }, { id: 'cccccccc-3333-4333-8333-cccccccccccc' }],
    projectA.id,
  )
  eq(summary.projects, 2, 'well-formed unique projects only')
  eq(snapshot.workspaces.length, 2, 'two notebooks')
  ok(!snapshot.workspaces.some((workspace) => workspace.projectId === '__proto__'), 'unsafe id rejected')
})

check('a hand-made notebook that already points at a project is adopted instead of duplicated', () => {
  const snapshot = baseSnapshot()
  snapshot.workspaces.push({ id: 'ws-manual', name: 'Manual', icon: 'book', path: projectB.path, createdAt: stamp, updatedAt: stamp })
  const summary = api.model.syncProjects(snapshot, [projectB], projectB.id)
  eq(summary.linked, 1, 'linked')
  eq(snapshot.workspaces.filter((workspace) => workspace.projectId === projectB.id).length, 1, 'one notebook for the project')
  eq(snapshot.workspaces.length, 2, 'legacy notebook stays as unlinked')
})

check('binding an unlinked notebook to an occupied project merges its documents', () => {
  const snapshot = baseSnapshot()
  snapshot.workspaces.push({
    id: 'ws-manual',
    name: 'Scratch',
    icon: 'book',
    createdAt: stamp,
    updatedAt: stamp,
  })
  snapshot.nodes.push({
    id: 'doc-manual',
    workspaceId: 'ws-manual',
    parentId: null,
    kind: 'doc',
    title: 'Scratch note',
    status: 'draft',
    tags: [],
    favorite: false,
    trashed: false,
    order: 0,
    createdAt: stamp,
    updatedAt: stamp,
    content: 'move me',
  })
  api.model.syncProjects(snapshot, [projectA], projectA.id)
  snapshot.ui.activeWorkspaceId = 'ws-manual'
  const bound = snapshot.workspaces.find((workspace) => workspace.projectId === projectA.id)
  const result = api.model.bindWorkspaceToProject(snapshot, 'ws-manual', projectA)
  eq(result.merged, true, 'merged')
  eq(result.moved, 1, 'one document moved')
  ok(!snapshot.workspaces.some((workspace) => workspace.id === 'ws-manual'), 'shell removed')
  eq(snapshot.nodes.find((node) => node.id === 'doc-manual').workspaceId, bound.id, 'note now lives in the project notebook')
  eq(snapshot.ui.activeWorkspaceId, bound.id, 'active workspace follows the merge')
})

check('binding a notebook to a free project just adopts the project metadata', () => {
  const snapshot = baseSnapshot()
  snapshot.workspaces.push({ id: 'ws-manual', name: 'Scratch', icon: 'book', createdAt: stamp, updatedAt: stamp })
  const result = api.model.bindWorkspaceToProject(snapshot, 'ws-manual', projectB)
  eq(result.merged, false, 'no merge needed')
  const workspace = api.model.workspaceById(snapshot, 'ws-manual')
  eq(workspace.projectId, projectB.id, 'project id')
  eq(workspace.name, projectB.title, 'name follows project')
  eq(workspace.path, projectB.path, 'path follows project')
})

check('project helpers are stable and deterministic', () => {
  eq(api.model.isProjectWorkspace(projectA), false, 'plain object is not a workspace')
  eq(api.model.isProjectWorkspace({ projectId: projectA.id }), true, 'bound workspace')
  eq(api.model.projectWorkspaceId(projectA.id), 'ws-proj-aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'readable stable id')
  eq(api.model.projectWorkspaceId(projectA.id), api.model.projectWorkspaceId(projectA.id), 'deterministic')
  eq(api.model.projectHue(projectA.id), api.model.projectHue(projectA.id), 'stable hue')
  ok(api.model.projectHue(projectA.id) !== api.model.projectHue(projectB.id), 'different projects get different dots')
})

check('the store syncs the project list from the host and reports a failure without breaking', async () => {
  eq(typeof api.createStore, 'function', 'createStore exported')
  const payload = { projects: [projectA, projectB], defaultProjectId: projectA.id, directory: 'C:\\home\\storages', source: 'C:\\home\\storages\\workspace.json', exists: true }
  const store = loadClient(fetchFor({ '/projects GET': () => payload })).createStore()
  const result = await store.syncProjects()
  eq(result.status, 'ready', 'ready')
  eq(result.projects.length, 2, 'two projects')
  eq(store.state.projects.defaultProjectId, projectA.id, 'default id')
  eq(store.state.snapshot.workspaces.length, 0, 'syncing projects does not mutate the notebook snapshot by itself')

  const broken = loadClient(async () => {
    throw new Error('host offline')
  }).createStore()
  let failed = false
  try {
    await broken.syncProjects()
  } catch {
    failed = true
  }
  eq(failed, true, 'sync rejection is surfaced')
  eq(broken.state.projects.status, 'error', 'error status')
  ok(/host offline/.test(broken.state.projects.error), 'error message kept')
})

for (const run of pending) await run()

if (failures.length > 0) {
  console.error('\nprojects: ' + failures.length + ' failed, ' + passed + ' passed')
  for (const failure of failures) console.error(' - ' + failure)
  process.exit(1)
}
console.log('\nprojects: ' + passed + ' checks passed')
