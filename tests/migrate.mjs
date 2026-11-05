// Legacy-directory migration test: a data directory written under the pre-rename name
// (`<DSH_HOME>/alexandrie`) must be moved into place on mount, with documents, media
// and the layout copy intact, and the old directory gone.
//
// Runs the real host half against a throwaway DSH_HOME; nothing here touches the live store.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'

const STAMP = '2026-01-01T00:00:00.000Z'

const snapshot = {
  version: 1,
  workspaces: [{ id: 'ws-1', name: 'Docs HQ', icon: 'book', createdAt: STAMP, updatedAt: STAMP }],
  nodes: [
    {
      id: 'doc-1',
      workspaceId: 'ws-1',
      parentId: null,
      kind: 'doc',
      title: 'Kept through the rename',
      status: 'active',
      tags: [],
      favorite: false,
      trashed: false,
      order: 0,
      createdAt: STAMP,
      updatedAt: STAMP,
      media: [{ id: 'media-1', name: 'diagram.png', mime: 'image/png', size: 5, uploadedAt: STAMP }],
      content: '# Kept through the rename\n',
    },
  ],
  settings: { view: 'list', editorMode: 'split', fontSize: 15, autoSave: true, showLineNumbers: true, sort: 'manual' },
  ui: { activeWorkspaceId: 'ws-1', activeNodeId: 'doc-1', expanded: [] },
  canvas: { items: [], links: [] },
  graph: { showTags: false, showLabels: true, scopeAll: false },
}

async function mount(home) {
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
  return { server, port }
}

async function getState(port) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/dsh-scriptorium/state', method: 'GET' }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', reject)
    req.end()
  })
}

const home = await mkdtemp(join(tmpdir(), 'scr-migrate-'))
const legacy = join(home, 'alexandrie')
const current = join(home, 'scriptorium')
await mkdir(join(legacy, 'media'), { recursive: true })
await writeFile(
  join(legacy, 'data.json'),
  JSON.stringify({ version: 1, revision: 12, updatedAt: STAMP, snapshot }, null, 2),
  'utf8',
)
await writeFile(join(legacy, 'media', 'media-1'), Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'binary')
await writeFile(join(legacy, 'media', 'media-1.json'), JSON.stringify(snapshot.nodes[0].media[0]), 'utf8')
await writeFile(
  join(legacy, 'layout.json'),
  JSON.stringify({ version: 1, canvas: { items: [{ id: 'card-1' }], links: [] }, graph: { showTags: true } }),
  'utf8',
)

const { server, port } = await mount(home)

try {
  assert.equal(fs.existsSync(current), true, 'the renamed directory exists after mount')
  assert.equal(fs.existsSync(legacy), false, 'the old directory is gone, not duplicated')
  const state = await getState(port)
  assert.equal(state.status, 200, 'state responds: ' + state.text)
  const payload = JSON.parse(state.text)
  assert.ok(payload.ok === true && payload.value, 'state envelope carries a value')
  assert.equal(payload.value.snapshot.nodes.length, 1, 'documents survived the move')
  assert.equal(payload.value.snapshot.nodes[0].title, 'Kept through the rename')
  assert.equal(payload.value.snapshot.nodes[0].media.length, 1, 'media index survived')
  assert.equal(payload.value.revision, 12, 'revision counter survived')

  const stored = JSON.parse(await readFile(join(current, 'data.json'), 'utf8'))
  assert.equal(stored.snapshot.nodes[0].id, 'doc-1')
  const layout = JSON.parse(await readFile(join(current, 'layout.json'), 'utf8'))
  assert.equal(layout.canvas.items[0].id, 'card-1', 'canvas cards survived in the layout copy')
  assert.equal((await stat(join(current, 'media', 'media-1'))).size, 4, 'attachment bytes survived')
  assert.equal(JSON.parse(await readFile(join(current, 'media', 'media-1.json'), 'utf8')).name, 'diagram.png')

  // A second mount on an already-renamed home must not invent anything or move twice.
  const again = await mount(home)
  const repeated = await getState(again.port)
  assert.equal(repeated.status, 200)
  assert.equal(JSON.parse(repeated.text).value.snapshot.nodes.length, 1)
  await new Promise((resolve) => again.server.close(resolve))

  console.log('migrate: legacy directory moved with documents, media, layout and revision intact')
} finally {
  await new Promise((resolve) => server.close(resolve))
  await rm(home, { recursive: true, force: true })
}
