// Archive unit tests: the ZIP writer/reader and the note archive format, no host involved.

import assert from 'node:assert/strict'
import { buildZip, crc32, parseZip } from '../lib/zip.js'
import { ARCHIVE_FORMAT, buildArchive, parseArchive, remapSnapshot } from '../lib/archive.js'

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

check('crc32 matches the reference value for "123456789"', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926)
})

check('the ZIP writer and reader round-trip unicode names and binary data', () => {
  const binary = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255])
  const zip = buildZip([
    { name: 'notes/ünïcode note.md', data: Buffer.from('# Gréetings ✓\n\nbody', 'utf8') },
    { name: 'media/blob.bin', data: binary },
  ])
  assert.equal(zip.subarray(0, 2).toString('latin1'), 'PK')
  const entries = parseZip(zip)
  assert.equal(entries.length, 2)
  const note = entries.find((entry) => entry.name.endsWith('.md'))
  const blob = entries.find((entry) => entry.name === 'media/blob.bin')
  assert.ok(note, 'note entry present')
  assert.ok(blob, 'binary entry present')
  assert.equal(note.data.toString('utf8'), '# Gréetings ✓\n\nbody')
  assert.deepEqual([...blob.data], [...binary])
})

check('a truncated ZIP is rejected instead of misread', () => {
  const zip = buildZip([{ name: 'a.txt', data: Buffer.from('hello') }])
  assert.throws(() => parseZip(zip.subarray(0, zip.length - 12)))
})

const snapshot = {
  version: 1,
  settings: { view: 'list', editorMode: 'split', fontSize: 15 },
  ui: { activeWorkspaceId: 'ws-1', activeNodeId: 'doc-1', expanded: [] },
  workspaces: [{ id: 'ws-1', name: 'Docs HQ', icon: 'book', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
  nodes: [
    {
      id: 'doc-1',
      workspaceId: 'ws-1',
      parentId: null,
      kind: 'doc',
      title: 'Welcome guide',
      status: 'active',
      tags: ['intro', 'guide'],
      favorite: true,
      trashed: false,
      order: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      media: [{ id: 'media-1', name: 'diagram.png', mime: 'image/png', size: 5, uploadedAt: '2026-01-02T00:00:00.000Z' }],
      content: '# Welcome guide\n\nSee the **diagram** below.\n\n- [x] ship it',
    },
    {
      id: 'folder-1',
      workspaceId: 'ws-1',
      parentId: null,
      kind: 'folder',
      title: 'Notes',
      order: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'doc-2',
      workspaceId: 'ws-1',
      parentId: 'folder-1',
      kind: 'doc',
      title: 'Nested note',
      status: 'draft',
      tags: [],
      order: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      content: 'Nested body',
    },
  ],
}

const media = [{ id: 'media-1', name: 'diagram.png', mime: 'image/png', data: Buffer.from([137, 80, 78, 71, 13]) }]

check('buildArchive writes a manifest, note files and media bytes', () => {
  const zip = buildArchive({ snapshot, media })
  const names = parseZip(zip).map((entry) => entry.name)
  assert.ok(names.includes('manifest.json'), 'manifest present')
  assert.ok(names.some((name) => name.startsWith('notes/')), 'notes present')
  assert.ok(names.some((name) => name.startsWith('media/')), 'media present')
})

check('parseArchive restores the tree, tags and attachment bytes', () => {
  const zip = buildArchive({ snapshot, media })
  const result = parseArchive(zip)
  assert.equal(result.snapshot.workspaces[0].name, 'Docs HQ')
  const welcome = result.snapshot.nodes.find((node) => node.title === 'Welcome guide')
  assert.ok(welcome, 'welcome note restored')
  assert.equal(welcome.status, 'active')
  assert.deepEqual(welcome.tags, ['intro', 'guide'])
  assert.match(welcome.content, /See the \*\*diagram\*\*/)
  assert.equal(result.media.length, 1)
  assert.equal(result.media[0].name, 'diagram.png')
  assert.deepEqual([...result.media[0].data], [...media[0].data])
})

check('parseArchive falls back to plain Markdown files when the manifest is gone', () => {
  const zip = buildZip([
    { name: 'notes/1-hello.md', data: Buffer.from('# Hello\n\nfrom markdown', 'utf8') },
    { name: 'notes/2-second.md', data: Buffer.from('# Second\n\ntext', 'utf8') },
  ])
  const result = parseArchive(zip)
  assert.ok(result.snapshot !== null)
  assert.equal(result.snapshot.nodes.length, 2)
  assert.equal(result.snapshot.workspaces.length, 1)
})

check('remapSnapshot gives every id a fresh value and keeps the relations', () => {
  const parsed = parseArchive(buildArchive({ snapshot, media }))
  const withOriginal = parsed.media.map((item) => Object.assign({ originalId: item.id }, item))
  const remapped = remapSnapshot(parsed.snapshot, withOriginal)
  const freshIds = new Set(remapped.snapshot.nodes.map((node) => node.id))
  for (const node of remapped.snapshot.nodes) assert.ok(!snapshot.nodes.some((old) => old.id === node.id), 'node id is new')
  const folder = remapped.snapshot.nodes.find((node) => node.title === 'Notes')
  const nested = remapped.snapshot.nodes.find((node) => node.title === 'Nested note')
  assert.ok(freshIds.has(nested.parentId), 'parent link still points at a real node')
  assert.equal(nested.parentId, folder.id)
  const welcome = remapped.snapshot.nodes.find((node) => node.title === 'Welcome guide')
  assert.equal(welcome.media[0].id, remapped.media[0].id, 'node.media points at the remapped attachment')
  assert.ok(!remapped.snapshot.workspaces.some((workspace) => workspace.id === 'ws-1'), 'workspace id is new')
})

check('the manifest records the archive format and the export date', () => {
  const zip = buildArchive({ snapshot, media, exportedAt: '2026-02-03T04:05:06.000Z' })
  const manifest = JSON.parse(parseZip(zip).find((entry) => entry.name === 'manifest.json').data.toString('utf8'))
  assert.equal(manifest.format, ARCHIVE_FORMAT)
  assert.equal(manifest.exportedAt, '2026-02-03T04:05:06.000Z')
  assert.equal(manifest.snapshot.nodes.filter((node) => node.kind === 'doc').length, 2)
  assert.equal(manifest.media.length, 1)
})

if (process.exitCode === undefined) console.log('\narchive: ' + passed + ' checks passed')
