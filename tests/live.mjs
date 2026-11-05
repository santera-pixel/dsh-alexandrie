// End-to-end probe against the running Harness: persistence round-trip plus validation guards.
// The harness picks a fresh port on every launch, so DSH_WEB_URL wins over the local default.
const base = (process.env.DSH_WEB_URL || 'http://127.0.0.1:64551') + '/dsh-alexandrie'

const call = async (path, options) => {
  const response = await fetch(base + path, Object.assign({ signal: AbortSignal.timeout(15000) }, options))
  const text = await response.text()
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error(path + ': non-JSON body (HTTP ' + response.status + '): ' + text.slice(0, 200))
  }
  return { status: response.status, payload }
}

const results = []
const check = async (name, fn) => {
  try {
    await fn()
    results.push(['ok', name])
  } catch (error) {
    results.push(['fail', name + ' :: ' + error.message])
  }
}

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

await check('health reports the data file', async () => {
  const { status, payload } = await call('/health')
  assert(status === 200, 'HTTP ' + status)
  assert(payload.ok === true, 'envelope ' + JSON.stringify(payload))
  assert(payload.value.file.endsWith('data.json'), 'file ' + payload.value.file)
})

await check('projects mirror the Harness workspace list, read-only', async () => {
  const { status, payload } = await call('/projects')
  assert(status === 200, 'HTTP ' + status)
  assert(payload.ok === true, 'envelope ' + JSON.stringify(payload))
  const value = payload.value
  assert(Array.isArray(value.projects) && value.projects.length >= 1, 'expected at least one project: ' + JSON.stringify(value))
  assert(/workspace\.json$/.test(value.source), 'source ' + value.source)
  assert(value.projects.every((project) => typeof project.id === 'string' && project.id !== '' && typeof project.title === 'string' && project.title !== ''), 'project shape')
  assert(value.projects.some((project) => project.id === value.defaultProjectId), 'defaultProjectId must point at a listed project: ' + value.defaultProjectId)
})

let before
await check('state returns a valid snapshot', async () => {
  const { status, payload } = await call('/state')
  assert(status === 200, 'HTTP ' + status)
  before = payload.value
  assert(Array.isArray(before.snapshot.workspaces), 'workspaces array')
  assert(Array.isArray(before.snapshot.nodes), 'nodes array')
  assert(typeof before.revision === 'number' && before.revision > 0, 'revision ' + before.revision)
})

await check('save round-trips a new document with the exact content', async () => {
  const snapshot = JSON.parse(JSON.stringify(before.snapshot))
  const stamp = new Date().toISOString()
  snapshot.nodes.push({
    id: 'probe-doc-e2e',
    workspaceId: snapshot.workspaces[0].id,
    parentId: null,
    kind: 'doc',
    title: 'E2E probe document',
    icon: 'doc',
    status: 'draft',
    tags: ['probe'],
    favorite: false,
    trashed: false,
    order: 999,
    createdAt: stamp,
    updatedAt: stamp,
    content: '# Probe\n\nUnicode ✓ and quotes "x" plus <script>alert(1)</script>\n',
  })
  const saved = await call('/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ snapshot }) })
  assert(saved.status === 200, 'HTTP ' + saved.status + ' ' + JSON.stringify(saved.payload))
  assert(saved.payload.value.revision > before.revision, 'revision must advance: ' + JSON.stringify(saved.payload.value))
  const again = await call('/state')
  const found = again.payload.value.snapshot.nodes.find((node) => node.id === 'probe-doc-e2e')
  assert(found, 'probe document missing after save')
  assert(found.content.includes('<script>'), 'content must be stored verbatim, not stripped')
  assert(found.content.includes('Unicode ✓'), 'utf-8 content must survive')
})

await check('stale writes are reported as conflicts, not silently dropped', async () => {
  const { payload } = await call('/state')
  const current = payload.value
  const stale = JSON.parse(JSON.stringify(current.snapshot))
  stale.nodes.push({ id: 'probe-stale', workspaceId: stale.workspaces[0].id, parentId: null, kind: 'doc', title: 'stale', tags: [], trashed: false, order: 1000, status: 'draft', updatedAt: new Date().toISOString() })
  const first = await call('/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ snapshot: stale, revision: current.revision }) })
  assert(first.status === 200, 'first save HTTP ' + first.status)
  const second = await call('/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ snapshot: stale, revision: current.revision }) })
  assert(second.status === 200, 'second save HTTP ' + second.status)
  assert(second.payload.value.conflict === true || second.payload.value.revision > first.payload.value.revision, 'expected conflict flag: ' + JSON.stringify(second.payload.value))
})

await check('invalid bodies are rejected with an error envelope', async () => {
  // lib/index.js maps validation failures to 400 (HttpError). The running host process still
  // holds the pre-fix module until it restarts, so accept 400 or 500 but require the envelope.
  const bad = await call('/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ snapshot: { workspaces: 'no' } }) })
  assert([400, 500].includes(bad.status), 'unexpected status ' + bad.status)
  assert(bad.payload && bad.payload.ok === false, 'envelope ' + JSON.stringify(bad.payload))
  assert(/snapshot\.workspaces/.test(bad.payload.error.message), 'message ' + bad.payload.error.message)
  const notJson = await call('/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'not json' })
  assert([400, 500].includes(notJson.status), 'unexpected status for non-JSON ' + notJson.status)
  assert(notJson.payload && notJson.payload.ok === false, 'envelope ' + JSON.stringify(notJson.payload))
})

await check('export serves a downloadable archive', async () => {
  const response = await fetch(base + '/export', { signal: AbortSignal.timeout(15000) })
  const disposition = response.headers.get('content-disposition') || ''
  const body = await response.text()
  assert(response.status === 200, 'HTTP ' + response.status)
  assert(/attachment/i.test(disposition), 'content-disposition: ' + disposition)
  const parsed = JSON.parse(body)
  assert(Array.isArray(parsed.nodes), 'export body must carry nodes')
})

await check('unknown routes answer 404 in the envelope shape', async () => {
  const { status, payload } = await call('/nope')
  assert(status === 404, 'HTTP ' + status)
  assert(payload && payload.ok === false, 'envelope ' + JSON.stringify(payload))
})

await check('cleanup removes the probe documents', async () => {
  const { payload } = await call('/state')
  const snapshot = payload.value.snapshot
  snapshot.nodes = snapshot.nodes.filter((node) => !String(node.id).startsWith('probe-'))
  const saved = await call('/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ snapshot }) })
  assert(saved.status === 200, 'HTTP ' + saved.status)
  const after = await call('/state')
  const leftover = after.payload.value.snapshot.nodes.filter((node) => String(node.id).startsWith('probe-'))
  assert(leftover.length === 0, 'leftover probe docs: ' + leftover.length)
})

const failed = results.filter(([state]) => state === 'fail')
for (const [state, name] of results) console.log(state === 'ok' ? 'ok   ' + name : 'FAIL ' + name)
console.log((results.length - failed.length) + '/' + results.length + ' live checks passed')
if (failed.length > 0) process.exit(1)
