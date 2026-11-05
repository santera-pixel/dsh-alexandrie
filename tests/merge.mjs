// Import merger tests: a JSON archive must merge without ever overwriting what is already
// on the board, and malformed files must fail with a message the UI can show verbatim.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(here, '..', 'src', 'client', '10-store.js'), 'utf8')
const factory = new Function('require', 'window', 'document', 'fetch', source + '\n;return { parseJsonArchive, mergeSnapshot }\n')
const { parseJsonArchive, mergeSnapshot } = factory(() => ({}), {}, {}, () => null)

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
const current = {
  version: 1,
  workspaces: [{ id: 'ws-a', name: 'Local', icon: 'book', createdAt: stamp, updatedAt: stamp }],
  nodes: [
    { id: 'doc-a', workspaceId: 'ws-a', parentId: null, kind: 'doc', title: 'Local note', order: 0, createdAt: stamp, updatedAt: stamp, content: 'local' },
  ],
  settings: { autoSave: true },
  ui: { activeWorkspaceId: 'ws-a', activeNodeId: 'doc-a', expanded: [] },
}

const checkNode = (node) => {
  if (node === null || typeof node !== 'object' || typeof node.id !== 'string' || node.id === '') throw new Error('every imported node needs a non-empty id')
}

check('a full snapshot file is accepted', () => {
  const parsed = parseJsonArchive(JSON.stringify(current))
  assert.deepEqual(parsed.nodes.map((node) => node.id), ['doc-a'])
})

check('a payload wrapped in { snapshot } is accepted too', () => {
  const parsed = parseJsonArchive(JSON.stringify({ snapshot: current }))
  assert.equal(parsed.workspaces[0].name, 'Local')
})

check('garbage is rejected with a readable message', () => {
  assert.throws(() => parseJsonArchive('not json'), /file is not valid JSON/)
  assert.throws(() => parseJsonArchive('[1,2,3]'), /document tree/)
  assert.throws(() => parseJsonArchive(JSON.stringify({ nodes: [] })), /"workspaces"/)
  assert.throws(() => parseJsonArchive(JSON.stringify({ workspaces: [] })), /"nodes"/)
  assert.throws(() => parseJsonArchive(JSON.stringify({ workspaces: [], nodes: [{ title: 'no id' }] })), /non-empty id/)
  assert.doesNotThrow(() => parseJsonArchive(JSON.stringify({ workspaces: [], nodes: [] })), 'empty archive is legal')
  assert.equal(typeof checkNode, 'function')
})

check('merging keeps every local id and appends the incoming documents', () => {
  const incoming = parseJsonArchive(
    JSON.stringify({
      workspaces: [{ id: 'ws-b', name: 'Imported', icon: 'book', createdAt: stamp, updatedAt: stamp }],
      nodes: [{ id: 'doc-b', workspaceId: 'ws-b', parentId: null, kind: 'doc', title: 'Imported note', order: 0, createdAt: stamp, updatedAt: stamp, content: 'imported' }],
    }),
  )
  const merged = mergeSnapshot(current, incoming)
  assert.deepEqual(merged.workspaces.map((workspace) => workspace.id), ['ws-a', 'ws-b'])
  assert.deepEqual(merged.nodes.map((node) => node.id), ['doc-a', 'doc-b'])
  assert.equal(merged.nodes[0].content, 'local', 'existing content untouched')
})

check('a colliding id is skipped instead of overwriting local data', () => {
  const incoming = parseJsonArchive(
    JSON.stringify({
      workspaces: [{ id: 'ws-a', name: 'Hijacked', icon: 'book', createdAt: stamp, updatedAt: stamp }],
      nodes: [{ id: 'doc-a', workspaceId: 'ws-a', parentId: null, kind: 'doc', title: 'Hijacked note', order: 0, createdAt: stamp, updatedAt: stamp, content: 'hijacked' }],
    }),
  )
  const merged = mergeSnapshot(current, incoming)
  assert.equal(merged.workspaces.length, 1)
  assert.equal(merged.workspaces[0].name, 'Local')
  assert.equal(merged.nodes.length, 1)
  assert.equal(merged.nodes[0].title, 'Local note')
})

check('a document whose parent did not come along is re-rooted, not dropped', () => {
  const incoming = parseJsonArchive(
    JSON.stringify({
      workspaces: [{ id: 'ws-c', name: 'Imported', icon: 'book', createdAt: stamp, updatedAt: stamp }],
      nodes: [{ id: 'doc-c', workspaceId: 'ws-c', parentId: 'ghost-folder', kind: 'doc', title: 'Orphan', order: 0, createdAt: stamp, updatedAt: stamp, content: 'orphan' }],
    }),
  )
  const merged = mergeSnapshot(current, incoming)
  const orphan = merged.nodes.find((node) => node.id === 'doc-c')
  assert.ok(orphan)
  assert.equal(orphan.parentId, null)
})

check('a nested import keeps its parent when both arrive together', () => {
  const incoming = parseJsonArchive(
    JSON.stringify({
      workspaces: [{ id: 'ws-d', name: 'Imported', icon: 'book', createdAt: stamp, updatedAt: stamp }],
      nodes: [
        { id: 'folder-d', workspaceId: 'ws-d', parentId: null, kind: 'folder', title: 'Folder', order: 0, createdAt: stamp, updatedAt: stamp },
        { id: 'doc-d', workspaceId: 'ws-d', parentId: 'folder-d', kind: 'doc', title: 'Child', order: 0, createdAt: stamp, updatedAt: stamp, content: 'child' },
      ],
    }),
  )
  const merged = mergeSnapshot(current, incoming)
  const child = merged.nodes.find((node) => node.id === 'doc-d')
  assert.equal(child.parentId, 'folder-d')
})

check('merging a null snapshot degrades to an empty import instead of throwing', () => {
  const merged = mergeSnapshot(current, null)
  assert.deepEqual(merged.nodes.map((node) => node.id), ['doc-a'])
})

if (process.exitCode === undefined) console.log('\nmerge: ' + passed + ' checks passed')
